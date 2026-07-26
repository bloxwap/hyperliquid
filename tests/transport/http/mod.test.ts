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

    describe("Retry-After grammar (RFC 9110)", () => {
      /** Builds the error directly with the given Retry-After header value. */
      function retryAfterOf(headerValue: string): number | undefined {
        const response = new Response("", { status: 429, headers: { "Retry-After": headerValue } });
        return new HttpRateLimitError({ response }).retryAfter;
      }

      const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const pad2 = (n: number): string => String(n).padStart(2, "0");
      const timeOfDay = (d: Date): string =>
        `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

      /** IMF-fixdate: `Sun, 06 Nov 1994 08:49:37 GMT`. */
      function imfFixdate(d: Date): string {
        const date = `${DAYS_SHORT[d.getUTCDay()]}, ${pad2(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]}`;
        return `${date} ${d.getUTCFullYear()} ${timeOfDay(d)} GMT`;
      }

      /** RFC 850: `Sunday, 06-Nov-94 08:49:37 GMT`. */
      function rfc850Date(d: Date): string {
        const date = `${DAYS_LONG[d.getUTCDay()]}, ${pad2(d.getUTCDate())}-${MONTHS_SHORT[d.getUTCMonth()]}`;
        return `${date}-${pad2(d.getUTCFullYear() % 100)} ${timeOfDay(d)} GMT`;
      }

      /** asctime: `Sun Nov  6 08:49:37 1994` (a single-digit day is padded with a second space). */
      function asctimeDate(d: Date): string {
        const day = d.getUTCDate();
        const date = `${DAYS_SHORT[d.getUTCDay()]} ${MONTHS_SHORT[d.getUTCMonth()]} ${day < 10 ? ` ${day}` : day}`;
        return `${date} ${timeOfDay(d)} ${d.getUTCFullYear()}`;
      }

      test("accepts delay-seconds (decimal digits only)", () => {
        assertEquals(retryAfterOf("30"), 30);
        assertEquals(retryAfterOf(" 30 "), 30); // optional surrounding whitespace
        assertEquals(retryAfterOf("0"), 0);
        assertEquals(retryAfterOf("007"), 7);
      });

      test("rejects junk that Number() would have accepted", () => {
        for (const junk of ["", " ", "-1", "1.5", "1e3", "0x10", "10s", "+10", "3.0", "Infinity"]) {
          assertEquals(retryAfterOf(junk), undefined, `expected undefined for ${JSON.stringify(junk)}`);
        }
      });

      test("safe-integer delays are preserved verbatim, however large", () => {
        assertEquals(retryAfterOf("3600"), 3600);
        assertEquals(retryAfterOf("3601"), 3601); // the server asked for it, the error reports it
        assertEquals(retryAfterOf("9007199254740991"), Number.MAX_SAFE_INTEGER); // the boundary
      });

      test("delay-seconds beyond the safe-integer range is garbage, not a delay", () => {
        assertEquals(retryAfterOf("9".repeat(400)), undefined); // Number would overflow to Infinity
        assertEquals(retryAfterOf("9007199254740992"), undefined); // 2^53: the first non-safe integer
      });

      test("accepts all three RFC 9110 HTTP-date forms", () => {
        const future = new Date(Date.now() + 30_000);
        for (const format of [imfFixdate, rfc850Date, asctimeDate]) {
          const retryAfter = retryAfterOf(format(future));
          assert(
            retryAfter !== undefined && retryAfter > 0 && retryAfter <= 30,
            `expected (0, 30] for ${format(future)}`,
          );
        }
      });

      test("past dates clamp to 0 in every form", () => {
        const past = new Date(Date.now() - 60_000);
        for (const format of [imfFixdate, rfc850Date, asctimeDate]) {
          assertEquals(retryAfterOf(format(past)), 0, `expected 0 for ${format(past)}`);
        }
      });

      test("a far-future date preserves its real seconds (single-digit asctime day included)", () => {
        // Nov 6 2094: a single-digit day, padded with a second space per the asctime grammar.
        const farFuture = new Date(Date.UTC(2094, 10, 6, 8, 49, 37));
        const header = asctimeDate(farFuture);
        assert(header.includes("Nov  6"));

        const retryAfter = retryAfterOf(header);
        assert(retryAfter !== undefined);
        const expected = (farFuture.getTime() - Date.now()) / 1000;
        assert(Math.abs(retryAfter - expected) < 2, `expected ~${expected}, got ${retryAfter}`);
      });

      test("rejects invalid weekday and month tokens", () => {
        assertEquals(retryAfterOf("Xxx, 06 Nov 1994 08:49:37 GMT"), undefined);
        assertEquals(retryAfterOf("Funday, 06-Nov-94 08:49:37 GMT"), undefined);
        assertEquals(retryAfterOf("Sun, 06 Foo 1994 08:49:37 GMT"), undefined);
        // 1994-11-06 was a Sunday: a contradicting weekday marks the value as garbage.
        assertEquals(retryAfterOf("Mon, 06 Nov 1994 08:49:37 GMT"), undefined);
        // ...while the correct weekday parses (a past date clamps to 0).
        assertEquals(retryAfterOf("Sun, 06 Nov 1994 08:49:37 GMT"), 0);
      });

      test("validates every date component arithmetically", () => {
        assertEquals(retryAfterOf("Sun, 31 Feb 1994 08:49:37 GMT"), undefined); // no such calendar day
        assertEquals(retryAfterOf("Sun, 06 Nov 1994 24:00:00 GMT"), undefined); // hour 24
        assertEquals(retryAfterOf("Sun, 06 Nov 1994 08:60:37 GMT"), undefined); // minute 60
        assertEquals(retryAfterOf("Sun, 06 Nov 1994 08:49:61 GMT"), undefined); // second 61
      });

      test("second 60 is the leap-second marker, read as the final second of the minute", () => {
        // 1994-11-06 was a Sunday; the past date clamps to 0 — the point is that ss=60 parses
        // at all (ss=61 above does not).
        assertEquals(retryAfterOf("Sun, 06 Nov 1994 08:49:60 GMT"), 0);
      });

      test("RFC 850 two-digit years: more than 50 years out rolls back a century", () => {
        const currentYear = new Date().getUTCFullYear();

        // 49 years out: no rollback — even though the runtime's naive 2-digit mapping would
        // read the same two digits as a year in the previous century.
        const future = new Date(Date.UTC(currentYear + 49, 10, 6, 8, 49, 37));
        const futureRetry = retryAfterOf(rfc850Date(future));
        assert(futureRetry !== undefined && futureRetry > 0, `expected a future delay for ${rfc850Date(future)}`);
        assert(Math.abs(futureRetry - (future.getTime() - Date.now()) / 1000) < 2);

        // 51 years out: rolls back 100 years, so the very same two digits mean the past.
        const resolved = new Date(Date.UTC(currentYear - 49, 10, 6, 8, 49, 37));
        assertEquals(retryAfterOf(rfc850Date(resolved)), 0);
      });

      test("rejects garbage that merely ends in GMT", () => {
        assertEquals(retryAfterOf("Sun, 99 Foo 1994 08:49:37 GMT"), undefined);
        assertEquals(retryAfterOf("not a date GMT"), undefined);
      });
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

    test("payloads without a signature still become a snapshot copy, never the live object", async () => {
      mockFetch(() => new Response("", { status: 500 }));

      const transport = new HttpTransport();
      const payload = { type: "allMids" };
      const error = await assertRejects(() => transport.request("info", payload), HttpRequestError);
      assertEquals(error.request, payload); // same content…
      assert(error.request !== payload); // …but always a snapshot copy, never the live object
    });

    test("redaction is recursive: multi-sig signatures and nested payloads", async () => {
      const realR = `0x${"a".repeat(64)}`;
      const realS = `0x${"b".repeat(64)}`;
      const multisigPayload = {
        action: {
          type: "multiSig",
          signatureChainId: "0x1",
          signatures: [
            { r: realR, s: realS, v: 27 },
            { r: realR, s: realS, v: 28 },
          ],
          payload: {
            multiSigUser: "0x111",
            outerSigner: "0x222",
            action: { type: "order", orders: [{ a: 0, b: true }] },
          },
        },
        signature: { r: realR, s: realS, v: 27 },
        nonce: 999,
      };

      let sentBody = "";
      mockFetch((_req, init) => {
        sentBody = init?.body as string;
        return new Response("error body", { status: 500 });
      });

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("exchange", multisigPayload), HttpRequestError);

      // No real signature hex anywhere in the serialized public error, at any depth.
      const serialized = JSON.stringify(error.request);
      assert(!serialized.includes("a".repeat(64)), "real r leaked into error.request");
      assert(!serialized.includes("b".repeat(64)), "real s leaked into error.request");
      assert(serialized.includes('"signature":"0x<redacted>"'));
      assert(serialized.includes('"signatures":["0x<redacted>","0x<redacted>"]'));
      // The action content survives.
      assert(serialized.includes('"type":"order"'));
      assert(serialized.includes("multiSigUser"));

      // The wire kept every real signature, and the caller's object was never mutated.
      assert(sentBody.includes(realR) && sentBody.includes(realS));
      assertEquals(multisigPayload.action.signatures[0].r, realR);
      assertEquals(multisigPayload.signature.r, realR);
    });
  });

  describe("unserializable payloads", () => {
    /** Asserts the payload never produces a wire serialization: no fetch, and a constant `request`. */
    async function assertUnserializable(payload: unknown): Promise<void> {
      const stub = stubFetch(() => jsonResponse());
      try {
        const transport = new HttpTransport();
        const error = await assertRejects(() => transport.request("exchange", payload), HttpRequestError);
        assertEquals(error.request, "[unserializable request]");
        assertEquals(stub.calls, 0);
      } finally {
        stub.restore();
      }
    }

    test("throwing signature getter", async () => {
      const payload = {
        action: { type: "order" },
        get signature(): string {
          throw new Error("getter exploded");
        },
        nonce: 1,
      };
      await assertUnserializable(payload);
    });

    test("throwing toJSON getter", async () => {
      const payload = {
        get toJSON(): unknown {
          throw new Error("toJSON getter exploded");
        },
      };
      await assertUnserializable(payload);
    });

    test("proxy with throwing ownKeys", async () => {
      const payload = new Proxy(
        { signature: { r: "0x1", s: "0x2", v: 27 } },
        {
          ownKeys() {
            throw new Error("proxy ownKeys exploded");
          },
        },
      );
      await assertUnserializable(payload);
    });

    test("function-valued properties follow JSON.stringify semantics (dropped)", async () => {
      let sentBody = "";
      mockFetch((_req, init) => {
        sentBody = init?.body as string;
        return new Response("", { status: 500 });
      });

      const payload = {
        action: { type: "order" },
        callback: () => "not serialized",
        signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 as const },
        nonce: 1,
      };
      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("exchange", payload), HttpRequestError);

      const serialized = JSON.stringify(error.request);
      assert(!serialized.includes("callback")); // function values never reach the wire, nor the snapshot
      assert(serialized.includes('"signature":"0x<redacted>"'));
      assert(sentBody.includes("1".repeat(64))); // the wire kept the real signature
    });

    test("a stateful toJSON runs exactly once — for the wire, not again for the error", async () => {
      let invocations = 0;
      const payload = {
        action: { type: "order" },
        nonce: 1,
        toJSON() {
          invocations++;
          return {
            action: { type: "order" },
            signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 as const },
            nonce: 1,
            seq: invocations,
          };
        },
      };
      mockFetch(() => new Response("", { status: 500 }));

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("exchange", payload), HttpRequestError);

      assertEquals(invocations, 1);
      const serialized = JSON.stringify(error.request);
      assert(serialized.includes('"seq":1')); // the snapshot is the wire call's output
      assert(serialized.includes('"signature":"0x<redacted>"'));
      assert(!serialized.includes("1".repeat(64)));
    });

    test("an own __proto__ key is redacted and preserved as an own key", async () => {
      const payload: Record<string, unknown> = { nonce: 1 };
      Object.defineProperty(payload, "__proto__", {
        value: { signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 } },
        enumerable: true,
      });
      mockFetch(() => new Response("", { status: 500 }));

      const transport = new HttpTransport();
      const error = await assertRejects(() => transport.request("exchange", payload), HttpRequestError);

      const request = error.request as Record<string, unknown>;
      const serialized = JSON.stringify(request);
      assert(!serialized.includes("1".repeat(64)), "signature under __proto__ leaked");
      assert(serialized.includes('"__proto__":{"signature":"0x<redacted>"}'));
      assertEquals(Object.getPrototypeOf(request), Object.prototype); // the copy's prototype is untouched
      assert("nonce" in request);
    });

    test("a 50_000-deep payload fails serialization and never masks the error", async () => {
      let payload: Record<string, unknown> = { signature: { r: "0x1", s: "0x2", v: 27 } };
      for (let i = 0; i < 50_000; i++) payload = { inner: payload };

      const stub = stubFetch(() => jsonResponse());
      try {
        const transport = new HttpTransport();
        // JSON.stringify throws on this depth; the wrapping error must still construct cleanly.
        const error = await assertRejects(() => transport.request("exchange", payload), HttpRequestError);
        assertEquals(error.request, "[unserializable request]");
        assertEquals(stub.calls, 0);
      } finally {
        stub.restore();
      }
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

        await transport.request("exchange", { action: { type: "noop" } }); // consumes the only token
        assertEquals(stub.calls, 1);

        const pending = transport.request("exchange", { action: { type: "noop" } }); // bucket empty: waits, no fetch yet
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

        const pending = transport.request("exchange", { action: { type: "noop" } }); // weight 1: waits 1 s
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

        await transport.request("exchange", { action: { type: "noop" } });
        const pending = transport.request("exchange", { action: { type: "noop" } }); // waits 1 s, far beyond the 100 ms timeout
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

    describe("documented weights", () => {
      /**
       * Asserts `payload` costs exactly `weight` tokens: with a capacity of exactly `weight` the
       * bucket is empty afterwards, so a follow-up unbatched exchange request (weight 1) waits
       * exactly one second at the 1 token/second refill.
       */
      async function assertWeight(endpoint: "info" | "exchange" | "explorer", payload: unknown, weight: number) {
        const stub = stubFetch(() => jsonResponse());
        try {
          const transport = new HttpTransport({ rateLimit: { capacity: weight, refillPerMinute: 60 } });

          await transport.request(endpoint, payload); // empties the bucket exactly
          assertEquals(stub.calls, 1);

          const pending = transport.request("exchange", { action: { type: "noop" } }); // weight 1
          await flush();
          assertEquals(stub.calls, 1);

          time.tick(999); // 1 ms short of the next token
          await flush();
          assertEquals(stub.calls, 1);

          time.tick(1);
          await pending;
          assertEquals(stub.calls, 2);
        } finally {
          stub.restore();
        }
      }

      // The classes from https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits
      test("info weight 2 (allMids)", async () => {
        await assertWeight("info", { type: "allMids" }, 2);
      });

      test("info weight 20 (any other documented request)", async () => {
        await assertWeight("info", { type: "meta" }, 20);
      });

      test("info weight 60 (userRole)", async () => {
        await assertWeight("info", { type: "userRole" }, 60);
      });

      test("explorer weight 40", async () => {
        await assertWeight("explorer", { type: "blockDetails" }, 40);
      });

      test("exchange unbatched weight 1", async () => {
        await assertWeight("exchange", { action: { type: "noop" } }, 1);
      });

      test("exchange multi-sig batch: the formula applies to the nested action", async () => {
        await assertWeight(
          "exchange",
          {
            action: {
              type: "multiSig",
              signatureChainId: "0x1",
              signatures: [{ r: "0x1", s: "0x2", v: 27 }],
              payload: {
                multiSigUser: "0x111",
                outerSigner: "0x222",
                action: { type: "order", orders: Array.from({ length: 41 }) }, // 41 nested orders: weight 2
              },
            },
          },
          2,
        );
      });

      test("billing derives from the serialized form, never from live getters or toJSON", async () => {
        const stub = stubFetch(() => jsonResponse());
        try {
          const transport = new HttpTransport({ rateLimit: { capacity: 2, refillPerMinute: 60 } });

          // The live object says "userRole" (60 weight); the serialized form says "allMids" (2).
          const payload = {
            get type(): string {
              return "userRole";
            },
            toJSON() {
              return { type: "allMids" };
            },
          };
          await transport.request("info", payload); // billed 2 — the wire's weight: empties the bucket
          assertEquals(stub.calls, 1);

          const pending = transport.request("exchange", { action: { type: "noop" } }); // weight 1: waits 1 s
          await flush();
          assertEquals(stub.calls, 1);

          time.tick(1_000);
          await pending;
          assertEquals(stub.calls, 2);
        } finally {
          stub.restore();
        }
      });
    });

    describe("response-size surcharges", () => {
      /**
       * Asserts the post-response debit: with a capacity of exactly `baseWeight`, the bucket is
       * at 0 after the request and the surcharge drives it to `-surcharge`, so the follow-up
       * weight-1 exchange request waits exactly `surcharge + 1` seconds at 1 token/second.
       */
      async function assertSurcharge(
        endpoint: "info" | "exchange" | "explorer",
        payload: unknown,
        itemCount: number,
        baseWeight: number,
        surcharge: number,
      ) {
        const stub = stubFetch(() => jsonResponse(Array.from({ length: itemCount })));
        try {
          const transport = new HttpTransport({ rateLimit: { capacity: baseWeight, refillPerMinute: 60 } });

          await transport.request(endpoint, payload); // bucket: 0 after the acquire, -surcharge after the debit
          assertEquals(stub.calls, 1);

          const pending = transport.request("exchange", { action: { type: "noop" } }); // deficit: surcharge + 1
          await flush();
          assertEquals(stub.calls, 1);

          time.tick(surcharge * 1_000); // one token still short
          await flush();
          assertEquals(stub.calls, 1);

          time.tick(1_000); // debt paid off plus the one token needed
          await pending;
          assertEquals(stub.calls, 2);
        } finally {
          stub.restore();
        }
      }

      test("userFills: 1 extra weight per 20 returned items", async () => {
        await assertSurcharge("info", { type: "userFills" }, 25, 20, 2); // ceil(25 / 20)
      });

      test("candleSnapshot: 1 extra weight per 60 returned items", async () => {
        await assertSurcharge("info", { type: "candleSnapshot" }, 61, 20, 2); // ceil(61 / 60)
      });

      test("blockList: 1 extra weight per returned block", async () => {
        await assertSurcharge("explorer", { type: "blockList" }, 3, 40, 3);
      });

      test("no surcharge on endpoints the docs do not list", async () => {
        await assertSurcharge("info", { type: "allMids" }, 100, 2, 0);
      });
    });

    describe("abort", () => {
      test("a pre-aborted signal rejects instantly without consuming weight", async () => {
        const stub = stubFetch(() => jsonResponse());
        try {
          const transport = new HttpTransport({ rateLimit: { capacity: 1, refillPerMinute: 60 } });
          const reason = new Error("cancelled before sending");

          const error = await assertRejects(
            () => transport.request("exchange", { action: { type: "noop" } }, AbortSignal.abort(reason)),
            HttpRequestError,
            "Request aborted",
          );
          assertEquals(error.cause, reason);
          assertEquals(stub.calls, 0); // never reached fetch

          // The token was not consumed: the next request proceeds without waiting.
          await transport.request("exchange", { action: { type: "noop" } });
          assertEquals(stub.calls, 1);
        } finally {
          stub.restore();
        }
      });

      test("aborting during a queued wait rejects without consuming weight", async () => {
        const stub = stubFetch(() => jsonResponse());
        try {
          const transport = new HttpTransport({ rateLimit: { capacity: 1, refillPerMinute: 60 } });

          await transport.request("exchange", { action: { type: "noop" } }); // consumes the only token
          assertEquals(stub.calls, 1);

          const controller = new AbortController();
          const pending = transport.request("exchange", { action: { type: "noop" } }, controller.signal);
          await flush(); // queued in the bucket, no fetch yet
          assertEquals(stub.calls, 1);

          controller.abort(new DOMException("user cancel", "AbortError"));
          const error = await assertRejects(() => pending, HttpRequestError, "Request aborted");
          assertIsError(error.cause, DOMException);
          assertEquals(stub.calls, 1); // never reached fetch

          // The aborted request consumed nothing: the survivor is served on the normal refill.
          const followUp = transport.request("exchange", { action: { type: "noop" } });
          await flush();
          assertEquals(stub.calls, 1);
          time.tick(1_000);
          await followUp;
          assertEquals(stub.calls, 2);
        } finally {
          stub.restore();
        }
      });

      test("the timeout still fires once the request is in flight", async () => {
        const stub = stubFetch(
          (_req, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
            }),
        );
        try {
          const transport = new HttpTransport({ timeout: 5, rateLimit: { capacity: 1, refillPerMinute: 60 } });

          const pending = transport.request("exchange", { action: { type: "noop" } });
          await flush(); // bucket full: acquired and sent, now hanging in fetch
          assertEquals(stub.calls, 1);

          time.tick(5); // fires the request timeout armed after the acquire
          await assertRejects(() => pending, HttpRequestError, "Request timed out after 5 ms");
        } finally {
          stub.restore();
        }
      });
    });
  });
});
