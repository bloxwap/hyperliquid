/**
 * Tests for HttpTransport against a mocked global fetch: URL routing,
 * error wrapping, fetch options merging, and abort/timeout handling.
 * @module
 */

import { afterEach, beforeEach, describe, test } from "bun:test";
import { getEventListeners } from "node:events";
import { assert, assertEquals, assertIsError, assertRejects } from "@jsr/std__assert";
import { FakeTime } from "@jsr/std__testing/time";
import { HttpRateLimitError, HttpRequestError, HttpTransport } from "@bloxwap/hyperliquid";

// =============================================================================
// Helpers
// =============================================================================

/** Arguments the runtime's `fetch` is called with (Bun widens the init type with its own options). */
type FetchArgs = Parameters<typeof globalThis.fetch>;

/** One-time mock for global fetch. */
function mockFetch(handler: (input: FetchArgs[0], init?: FetchArgs[1]) => Response | Promise<Response>): void {
  const originalFetch = globalThis.fetch;
  // `Object.assign` carries Bun's extra `fetch.preconnect` over, so the global keeps its declared shape.
  globalThis.fetch = Object.assign(
    async (...args: FetchArgs): Promise<Response> => {
      try {
        return await handler(...args);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    { preconnect: originalFetch.preconnect },
  );
}

/** Returns a successful JSON response. */
function jsonResponse(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Persistent mock for global fetch (restored manually), counting the requests it answers. */
function stubFetch(handler: (input: FetchArgs[0], init?: FetchArgs[1]) => Response | Promise<Response>): {
  calls: number;
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const stub = {
    calls: 0,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
  globalThis.fetch = Object.assign(
    async (...args: FetchArgs): Promise<Response> => {
      stub.calls++;
      return await handler(...args);
    },
    { preconnect: originalFetch.preconnect },
  );
  return stub;
}

/** Waits until queued promise reactions have settled. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// =============================================================================
// Test Data
// =============================================================================

const ENDPOINTS = ["info", "exchange", "explorer"] as const;

const URL_EXPECTATIONS = {
  mainnet: {
    info: "https://api.hyperliquid.xyz/info",
    exchange: "https://api.hyperliquid.xyz/exchange",
    explorer: "https://rpc.hyperliquid.xyz/explorer",
  },
  testnet: {
    info: "https://api.hyperliquid-testnet.xyz/info",
    exchange: "https://api.hyperliquid-testnet.xyz/exchange",
    explorer: "https://rpc.hyperliquid-testnet.xyz/explorer",
  },
} as const;

// =============================================================================
// Tests
// =============================================================================

describe("HttpTransport", () => {
  describe("URL routing", () => {
    describe("mainnet (default)", () => {
      const transport = new HttpTransport();

      for (const endpoint of ENDPOINTS) {
        test(`${endpoint}`, async () => {
          mockFetch((req) => {
            assertEquals(new Request(req).url, URL_EXPECTATIONS.mainnet[endpoint]);
            return jsonResponse();
          });
          await transport.request(endpoint, {});
        });
      }
    });

    describe("testnet (isTestnet: true)", () => {
      const transport = new HttpTransport({ isTestnet: true });

      for (const endpoint of ENDPOINTS) {
        test(`${endpoint}`, async () => {
          mockFetch((req) => {
            assertEquals(new Request(req).url, URL_EXPECTATIONS.testnet[endpoint]);
            return jsonResponse();
          });
          await transport.request(endpoint, {});
        });
      }
    });

    test("custom URLs", async () => {
      const transport = new HttpTransport({
        apiUrl: "https://custom-api.example.com",
        rpcUrl: "https://custom-rpc.example.com",
      });

      mockFetch((req) => {
        assertEquals(new Request(req).url, "https://custom-api.example.com/info");
        return jsonResponse();
      });
      await transport.request("info", {});

      mockFetch((req) => {
        assertEquals(new Request(req).url, "https://custom-rpc.example.com/explorer");
        return jsonResponse();
      });
      await transport.request("explorer", {});
    });

    test("custom URL with path and query keeps both", async () => {
      const transport = new HttpTransport({ apiUrl: "https://proxy.example.com/hl?key=secret" });

      mockFetch((req) => {
        assertEquals(new Request(req).url, "https://proxy.example.com/hl/info?key=secret");
        return jsonResponse();
      });
      await transport.request("info", {});
    });
  });

  describe("request()", () => {
    test("success response", async () => {
      mockFetch((_req, init) => {
        assertEquals(init?.method, "POST");
        assertEquals(new Headers(init?.headers).get("Content-Type"), "application/json");
        return jsonResponse({ data: "test" });
      });

      const transport = new HttpTransport();
      const result = await transport.request("info", {});
      assertEquals(result, { data: "test" });
    });

    describe("error responses", () => {
      test("non-200 status throws HttpRequestError", async () => {
        mockFetch(() => new Response("", { status: 500 }));

        const transport = new HttpTransport();
        await assertRejects(() => transport.request("info", {}), HttpRequestError);
      });

      test("invalid Content-Type throws HttpRequestError", async () => {
        mockFetch(() => new Response("", { status: 200, headers: { "Content-Type": "text/html" } }));

        const transport = new HttpTransport();
        await assertRejects(() => transport.request("info", {}), HttpRequestError);
      });

      test("invalid JSON in 2xx response throws HttpRequestError with readable response", async () => {
        mockFetch(() => new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } }));

        const transport = new HttpTransport();
        const error = await assertRejects(() => transport.request("info", {}), HttpRequestError, "Invalid JSON");
        assert(error.response);
        assertEquals(await error.response.text(), "not json");
      });

      test("error message truncates large response bodies", async () => {
        mockFetch(() => new Response("x".repeat(5000), { status: 500 }));

        const transport = new HttpTransport();
        const error = await assertRejects(() => transport.request("info", {}), HttpRequestError);
        assert(error.message.includes("(5000 chars total)"));
        assert(error.message.length < 1200);
        assertEquals(await error.response?.text(), "x".repeat(5000)); // full body stays readable
      });

      test("error carries the original request payload", async () => {
        mockFetch(() => new Response("", { status: 500 }));

        const transport = new HttpTransport();
        const error = await assertRejects(() => transport.request("info", { type: "test" }), HttpRequestError);
        assertEquals(error.request, { type: "test" });
      });

      test("response body is readable on error", async () => {
        mockFetch(() => new Response("error body", { status: 500 }));

        const transport = new HttpTransport();
        const error = await assertRejects(() => transport.request("info", {}), HttpRequestError);
        assert(error.response);
        assertEquals(error.response.bodyUsed, false);
        assertEquals(await error.response.text(), "error body");
      });

      test("unknown error wraps in HttpRequestError", async () => {
        mockFetch(() => {
          throw new Error("network error");
        });

        const transport = new HttpTransport();
        const error = await assertRejects(() => transport.request("info", {}), HttpRequestError);
        assertIsError(error.cause, Error, "network error");
      });
    });
  });

  describe("fetchOptions", () => {
    test("headers as object", async () => {
      mockFetch((_req, init) => {
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("Content-Type"), "application/json");
        assertEquals(headers.get("X-Custom"), "value");
        return jsonResponse();
      });

      const transport = new HttpTransport({
        fetchOptions: { headers: { "X-Custom": "value" } },
      });
      await transport.request("info", {});
    });

    test("headers as Headers instance", async () => {
      mockFetch((_req, init) => {
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("Content-Type"), "application/json");
        assertEquals(headers.get("X-Custom"), "value");
        return jsonResponse();
      });

      const transport = new HttpTransport({
        fetchOptions: { headers: new Headers({ "X-Custom": "value" }) },
      });
      await transport.request("info", {});
    });

    test("headers as array joins duplicate keys", async () => {
      mockFetch((_req, init) => {
        assertEquals(new Headers(init?.headers).get("X-Multi"), "a, b");
        return jsonResponse();
      });

      const transport = new HttpTransport({
        fetchOptions: {
          headers: [
            ["X-Multi", "a"],
            ["X-Multi", "b"],
          ],
        },
      });
      await transport.request("info", {});
    });
  });

  describe("AbortSignal", () => {
    test("internal timeout triggers TimeoutError", async () => {
      mockFetch(
        (_req, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      );

      const transport = new HttpTransport({ timeout: 1 });

      const error = await assertRejects(() => transport.request("info", {}), HttpRequestError, "Request timed out");
      assertIsError(error.cause, DOMException);
      assertEquals(error.cause.name, "TimeoutError");
    });

    test("user signal is respected", async () => {
      class CustomAbortError extends Error {}

      const transport = new HttpTransport();
      const signal = AbortSignal.abort(new CustomAbortError("user abort"));

      const error = await assertRejects(() => transport.request("info", {}, signal), HttpRequestError);
      assertIsError(error.cause, CustomAbortError);
    });

    test("in-flight abort rejects with 'Request aborted'", async () => {
      mockFetch(
        (_req, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      );

      const controller = new AbortController();
      const transport = new HttpTransport();
      const promise = transport.request("info", {}, controller.signal);
      controller.abort(new DOMException("user cancel", "AbortError"));

      const error = await assertRejects(() => promise, HttpRequestError, "Request aborted");
      assertIsError(error.cause, DOMException);
      assertEquals(error.cause.name, "AbortError");
    });

    test("timeout: 0 aborts immediately with TimeoutError", async () => {
      mockFetch(
        (_req, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      );

      const transport = new HttpTransport({ timeout: 0 });
      const error = await assertRejects(() => transport.request("info", {}), HttpRequestError, "Request timed out");
      assertIsError(error.cause, DOMException);
      assertEquals(error.cause.name, "TimeoutError");
    });

    test("timeout: null disables internal timeout", async () => {
      mockFetch(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return jsonResponse();
      });

      const transport = new HttpTransport({ timeout: null });
      await transport.request("info", {});
    });

    test("the timeout message reports the value the timer was armed with", async () => {
      mockFetch(
        (_req, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      );

      const transport = new HttpTransport({ timeout: 30 });
      const promise = transport.request("info", {});
      transport.timeout = null;

      await assertRejects(() => promise, HttpRequestError, "Request timed out after 30 ms");
    });

    test("fetchOptions.signal is respected", async () => {
      mockFetch(
        (_req, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      );

      const controller = new AbortController();
      const transport = new HttpTransport({ fetchOptions: { signal: controller.signal } });
      const promise = transport.request("info", {});
      controller.abort(new DOMException("user cancel", "AbortError"));

      const error = await assertRejects(() => promise, HttpRequestError, "Request aborted");
      assertIsError(error.cause, DOMException);
    });

    test("does not leak abort listeners on a long-lived user signal", async () => {
      const controller = new AbortController();
      const transport = new HttpTransport();
      for (let i = 0; i < 100; i++) {
        mockFetch(() => jsonResponse());
        await transport.request("info", {}, controller.signal);
      }

      assertEquals(getEventListeners(controller.signal, "abort").length, 0);
    });
  });

  describe("exchangeTimeout", () => {
    /** Never responds; rejects when the request's abort signal fires. */
    const hangUntilAbort = (_req: FetchArgs[0], init?: FetchArgs[1]): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });

    test("times exchange requests out with the override, info/explorer with the global timeout", async () => {
      const transport = new HttpTransport({ timeout: 30, exchangeTimeout: 5 });

      mockFetch(hangUntilAbort);
      await assertRejects(() => transport.request("exchange", {}), HttpRequestError, "Request timed out after 5 ms");

      mockFetch(hangUntilAbort);
      await assertRejects(() => transport.request("info", {}), HttpRequestError, "Request timed out after 30 ms");

      mockFetch(hangUntilAbort);
      await assertRejects(() => transport.request("explorer", {}), HttpRequestError, "Request timed out after 30 ms");
    });

    test("falls back to the global timeout when unset", async () => {
      const transport = new HttpTransport({ timeout: 5 });

      mockFetch(hangUntilAbort);
      await assertRejects(() => transport.request("exchange", {}), HttpRequestError, "Request timed out after 5 ms");
    });

    test("null disables the timeout for exchange requests only", async () => {
      mockFetch(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return jsonResponse();
      });

      // 30 ms exceeds the 5 ms global timeout, but the exchange override is disabled.
      const transport = new HttpTransport({ timeout: 5, exchangeTimeout: null });
      await transport.request("exchange", {});
    });

    test("is mutable like timeout", async () => {
      const transport = new HttpTransport({ timeout: 30 });
      transport.exchangeTimeout = 5;

      mockFetch(hangUntilAbort);
      await assertRejects(() => transport.request("exchange", {}), HttpRequestError, "Request timed out after 5 ms");
    });
  });

  describe("429 rate limit responses", () => {
    test("429 throws HttpRateLimitError carrying status and retryAfter", async () => {
      mockFetch(() => new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "30" } }));

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("info", {}), HttpRateLimitError);
      assert(error instanceof HttpRequestError); // existing instanceof checks keep matching
      assertEquals(error.status, 429);
      assertEquals(error.retryAfter, 30);
    });

    test("429 without a Retry-After header leaves retryAfter undefined", async () => {
      mockFetch(() => new Response("", { status: 429 }));

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("info", {}), HttpRateLimitError);
      assertEquals(error.retryAfter, undefined);
    });

    test("Retry-After in HTTP-date form is converted to seconds", async () => {
      const date = new Date(Date.now() + 30_000).toUTCString();
      mockFetch(() => new Response("", { status: 429, headers: { "Retry-After": date } }));

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("info", {}), HttpRateLimitError);
      assert(error.retryAfter !== undefined && error.retryAfter > 0 && error.retryAfter <= 30);
    });

    test("non-429 errors keep status on plain HttpRequestError", async () => {
      mockFetch(() => new Response("", { status: 500 }));

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("info", {}), HttpRequestError);
      assert(!(error instanceof HttpRateLimitError));
      assertEquals(error.status, 500);
    });
  });

  describe("request payload redaction", () => {
    const signedPayload = {
      action: { type: "order", orders: [{ a: 0, b: true }] },
      signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 as const },
      nonce: 12345,
    };

    test("error carries a redacted copy; the sent request keeps the real signature", async () => {
      let sentBody: Record<string, unknown> | undefined;
      mockFetch((_req, init) => {
        sentBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response("error body", { status: 500 });
      });

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("exchange", signedPayload), HttpRequestError);

      const redacted = error.request as Record<string, unknown>;
      assertEquals(redacted.signature, "0x<redacted>");
      assertEquals(redacted.action, signedPayload.action);
      assertEquals(redacted.nonce, 12345);

      // The wire kept the real signature, and the caller's object was never mutated.
      assertEquals(sentBody?.signature, signedPayload.signature);
      assertEquals(signedPayload.signature, { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 });
    });

    test("payloads without a signature pass through by reference", async () => {
      mockFetch(() => new Response("", { status: 500 }));

      const transport = new HttpTransport();
      const payload = { type: "allMids" };
      const error = await assertRejects(() => transport.request("info", payload), HttpRequestError);
      assert(error.request === payload);
    });
  });

  describe("rateLimit", () => {
    // The npm build of `@std/testing/time` drops the `[Symbol.dispose]` member the Deno version
    // declares, so the clock is installed and restored through hooks instead of a `using` binding.
    let time: FakeTime;

    beforeEach(() => {
      time = new FakeTime();
    });

    afterEach(() => {
      time.restore();
    });

    test("waits for weight before sending instead of throwing", async () => {
      const stub = stubFetch(() => jsonResponse());
      try {
        const transport = new HttpTransport({ rateLimit: { capacity: 1, refillPerMinute: 60 } }); // 1 weight/second

        await transport.request("info", {}); // consumes the only token
        assertEquals(stub.calls, 1);

        const pending = transport.request("info", {}); // bucket empty: waits, no fetch yet
        await flush();
        assertEquals(stub.calls, 1);

        time.tick(1_000); // one token refilled
        await pending;
        assertEquals(stub.calls, 2);
      } finally {
        stub.restore();
      }
    });

    test("exchange batches cost 1 + floor(batchLength / 40) weight", async () => {
      const stub = stubFetch(() => jsonResponse());
      try {
        const transport = new HttpTransport({ rateLimit: { capacity: 2, refillPerMinute: 60 } }); // 1 weight/second

        // 41 orders cost 2 weight: the whole bucket.
        await transport.request("exchange", { action: { type: "order", orders: Array.from({ length: 41 }) } });
        assertEquals(stub.calls, 1);

        const pending = transport.request("info", {});
        await flush();
        assertEquals(stub.calls, 1);

        time.tick(1_000);
        await pending;
        assertEquals(stub.calls, 2);
      } finally {
        stub.restore();
      }
    });

    test("throttled waits never trip the request timeout", async () => {
      const stub = stubFetch(() => jsonResponse());
      try {
        const transport = new HttpTransport({ timeout: 100, rateLimit: { capacity: 1, refillPerMinute: 60 } });

        await transport.request("info", {});
        const pending = transport.request("info", {}); // waits 1 s, far beyond the 100 ms timeout
        await flush();

        time.tick(1_000);
        await pending; // resolves: the timeout starts only once the request goes out
        assertEquals(stub.calls, 2);
      } finally {
        stub.restore();
      }
    });

    test("disabled by default: requests are never delayed client-side", async () => {
      const stub = stubFetch(() => jsonResponse());
      try {
        const transport = new HttpTransport();

        await transport.request("info", {});
        await transport.request("exchange", { action: { type: "order", orders: Array.from({ length: 100 }) } });
        assertEquals(stub.calls, 2); // both sent without ticking the clock
      } finally {
        stub.restore();
      }
    });
  });
});
