/**
 * The REST weight budget is per IP. Transports to one API host share a bucket instead of
 * each spending a full 1200/minute. Offline: an injected fetch and, where the wait matters,
 * a virtual clock.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertThrows } from "@jsr/std__assert";
import { HttpTransport, sharedHttpRateLimiter, TokenBucketRateLimiter } from "@bloxwap/hyperliquid";
import { FakeRuntime } from "../../_fakeRuntime.ts";

/** Arguments the injected fetch is called with. */
type FetchArgs = Parameters<typeof globalThis.fetch>;

/** Counts requests and answers each with `{}`. */
function countingFetch(): { calls: number; fetch: (input: FetchArgs[0], init?: FetchArgs[1]) => Promise<Response> } {
  const stub = {
    calls: 0,
    fetch: (_input: FetchArgs[0], _init?: FetchArgs[1]): Promise<Response> => {
      stub.calls++;
      return Promise.resolve(Response.json({}));
    },
  };
  return stub;
}

/** Lets queued promise reactions run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** One unbatched exchange action: weight 1. */
const NOOP = { action: { type: "noop" } };

describe("shared HTTP rate limit", () => {
  test("two transports sharing one limiter pace their combined weight", async () => {
    const clock = new FakeRuntime();
    const stub = countingFetch();
    const limiter = new TokenBucketRateLimiter(1, 60, clock); // 1 weight/second
    const host = "https://injected-share.example";
    const info = new HttpTransport({
      apiUrl: host,
      runtime: clock,
      timeout: null,
      fetch: stub.fetch,
      rateLimit: limiter,
    });
    const exchange = new HttpTransport({
      apiUrl: host,
      runtime: clock,
      timeout: null,
      fetch: stub.fetch,
      rateLimit: limiter,
    });

    await info.request("exchange", NOOP); // spends the only token
    const pending = exchange.request("exchange", NOOP);
    await flush();
    assertEquals(stub.calls, 1); // the second transport is waiting on the shared bucket

    clock.advance(1_000);
    await pending;
    assertEquals(stub.calls, 2);
  });

  test("the default budget is one process-wide bucket per host", async () => {
    const clock = new FakeRuntime();
    const host = "https://default-share.example";
    // Created first, so the process bucket for this host runs on the virtual clock.
    const limiter = sharedHttpRateLimiter(host, { capacity: 1200, refillPerMinute: 1200, runtime: clock });
    limiter.charge(1199); // one token left of the shared 1200
    const stub = countingFetch();
    const info = new HttpTransport({ apiUrl: host, timeout: null, fetch: stub.fetch, rateLimit: true });
    const exchange = new HttpTransport({
      apiUrl: `${host}/info`,
      timeout: null,
      fetch: stub.fetch,
      rateLimit: { capacity: 1200, refillPerMinute: 1200 },
    });

    await info.request("exchange", NOOP);
    const pending = exchange.request("exchange", NOOP);
    await flush();
    assertEquals(stub.calls, 1);

    clock.advance(50); // 1200/minute refills one token in 50 ms
    await pending;
    assertEquals(stub.calls, 2);
  });

  test("keys that bucket by hostname, ignoring case, path, and a default port", () => {
    const clock = new FakeRuntime();
    const spec = { capacity: 3, refillPerMinute: 3, runtime: clock };
    const first = sharedHttpRateLimiter("https://API.Example.com/info", spec);
    const second = sharedHttpRateLimiter(new URL("https://api.example.com"), spec);
    const defaultPort = sharedHttpRateLimiter("https://api.example.com:443/x", spec);
    assert(first === second);
    assert(first === defaultPort);
    assert(sharedHttpRateLimiter("https://api.example.com:444", spec) !== first);
  });

  test("a custom capacity stays private to the instance", async () => {
    const clock = new FakeRuntime();
    const stub = countingFetch();
    const options = {
      runtime: clock,
      timeout: null,
      fetch: stub.fetch,
      rateLimit: { capacity: 1, refillPerMinute: 60 },
    };
    const info = new HttpTransport(options);
    const exchange = new HttpTransport(options);

    await info.request("exchange", NOOP);
    const pending = exchange.request("exchange", NOOP);
    try {
      await flush();
      assertEquals(stub.calls, 2); // each instance started with its own token
    } finally {
      clock.advance(60_000);
      await pending;
    }
  });

  test("shared: false does not draw from the process bucket", async () => {
    const clock = new FakeRuntime();
    const host = "https://opt-out.example";
    const shared = sharedHttpRateLimiter(host, { runtime: clock });
    shared.charge(1200); // the process bucket is empty
    const stub = countingFetch();
    const controller = new AbortController();
    const transport = new HttpTransport({
      apiUrl: host,
      timeout: null,
      fetch: stub.fetch,
      rateLimit: { shared: false },
    });

    const pending = transport.request("exchange", NOOP, controller.signal);
    const result = await Promise.race([
      pending.then(
        () => "sent" as const,
        () => "failed" as const,
      ),
      new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 50)),
    ]);
    if (result !== "sent") controller.abort();
    assertEquals(result, "sent");
    assertEquals(stub.calls, 1);
  });

  test("a second shared budget for the same host with different numbers throws", () => {
    const host = "https://conflict.example";
    new HttpTransport({ apiUrl: host, rateLimit: { capacity: 50, refillPerMinute: 50, shared: true } });
    assertThrows(() => new HttpTransport({ apiUrl: host, rateLimit: true }), TypeError, "already has a bucket");
    assertThrows(
      () => sharedHttpRateLimiter(host, { capacity: 50, refillPerMinute: 49 }),
      TypeError,
      "already has a bucket",
    );
    // The matching budget is the one already created.
    const again = new HttpTransport({
      apiUrl: host,
      rateLimit: { capacity: 50, refillPerMinute: 50, shared: true },
    });
    assertEquals(again.isTestnet, false);
  });
});
