/**
 * Tests for the opt-in info-endpoint TTL cache: cache hits, TTL expiry, param-distinct
 * keys, in-flight dedup, failure eviction, bounded size, and disabled passthrough.
 * Entirely offline — the wrapped transport is a scripted mock, never the network.
 * @module
 */

import { afterEach, beforeEach, describe, test } from "bun:test";
import { assertEquals, assertRejects, assertThrows } from "@jsr/std__assert";
import { FakeTime } from "@jsr/std__testing/time";
import { InfoCacheTransport } from "../../src/transport/_infoCache.ts";
import type { IRequestTransport } from "../../src/transport/_base.ts";

type Endpoint = "info" | "exchange" | "explorer";

/** An {@linkcode IRequestTransport} that records calls and answers from a scripted handler. */
class MockTransport implements IRequestTransport<Endpoint> {
  readonly isTestnet = true;
  readonly calls: { endpoint: Endpoint; payload: unknown; signal?: AbortSignal }[] = [];

  constructor(readonly handler: (endpoint: Endpoint, payload: Record<string, unknown>) => unknown) {}

  async request<T>(endpoint: Endpoint, payload: unknown, signal?: AbortSignal): Promise<T> {
    this.calls.push({ endpoint, payload, signal });
    // `async` so a throwing handler rejects the returned promise, like a real transport's failures.
    return this.handler(endpoint, payload as Record<string, unknown>) as T;
  }
}

/** A handler that answers every payload with a distinct echo object. */
function echoHandler(_endpoint: Endpoint, payload: Record<string, unknown>): unknown {
  return { echo: payload };
}

describe("InfoCacheTransport", () => {
  let time: FakeTime;

  beforeEach(() => {
    time = new FakeTime();
  });

  afterEach(() => {
    time.restore();
  });

  test("serves a repeated allowlisted request from cache without a second network call", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });

    const first = await transport.request("info", { type: "meta" });
    const second = await transport.request("info", { type: "meta" });

    assertEquals(mock.calls.length, 1);
    assertEquals(second, first);
  });

  test("refetches once the TTL expires", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 1_000 });

    await transport.request("info", { type: "spotMeta" });
    time.tick(999);
    await transport.request("info", { type: "spotMeta" });
    assertEquals(mock.calls.length, 1); // one ms short of expiry: still cached

    time.tick(1);
    await transport.request("info", { type: "spotMeta" });
    assertEquals(mock.calls.length, 2); // exactly at expiry: stale, refetched
  });

  test("applies the default TTL unless a per-type override exists", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, {
      ttl: 60_000,
      ttlByType: { marginTable: 500 },
    });

    await transport.request("info", { type: "marginTable", id: 1 });
    await transport.request("info", { type: "meta" });
    time.tick(600);

    await transport.request("info", { type: "marginTable", id: 1 }); // override expired: refetch
    await transport.request("info", { type: "meta" }); // default TTL still fresh: cache hit
    assertEquals(mock.calls.length, 3);
  });

  test("keys entries by request params, so distinct params never collide", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });

    await transport.request("info", { type: "marginTable", id: 1 });
    await transport.request("info", { type: "marginTable", id: 2 });
    await transport.request("info", { type: "marginTable", id: 1, dex: "test" });
    await transport.request("info", { type: "meta", dex: "test" });
    await transport.request("info", { type: "meta" });
    assertEquals(mock.calls.length, 5);

    // Repeats hit the cache — including with a different param insertion order.
    const reordered = await transport.request("info", { dex: "test", id: 1, type: "marginTable" });
    await transport.request("info", { type: "marginTable", id: 1 });
    await transport.request("info", { type: "meta", dex: "test" });
    assertEquals(mock.calls.length, 5);
    assertEquals(reordered, { echo: { type: "marginTable", id: 1, dex: "test" } });
  });

  test("passes non-allowlisted info requests straight through", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });

    await transport.request("info", { type: "allMids" });
    await transport.request("info", { type: "allMids" });
    await transport.request("info", { type: "l2Book", coin: "ETH" });
    await transport.request("info", { type: "l2Book", coin: "ETH" });
    await transport.request("info", { type: "metaAndAssetCtxs" });
    await transport.request("info", { type: "metaAndAssetCtxs" });
    await transport.request("info", { type: "clearinghouseState", user: "0xabc" });
    await transport.request("info", { type: "clearinghouseState", user: "0xabc" });

    assertEquals(mock.calls.length, 8); // nothing cached
  });

  test("passes exchange and explorer requests straight through", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });

    await transport.request("exchange", { action: { type: "order" } });
    await transport.request("exchange", { action: { type: "order" } });
    await transport.request("explorer", { type: "blockList" });
    await transport.request("explorer", { type: "blockList" });

    assertEquals(mock.calls.length, 4);
    // Nothing exchange/explorer-shaped may leak into the info cache either:
    // an allowlisted info type shares no key with them.
    assertEquals(
      mock.calls.every((call) => call.endpoint !== "info"),
      true,
    );
  });

  test("ttl: 0 disables caching", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 0 });

    await transport.request("info", { type: "meta" });
    await transport.request("info", { type: "meta" });
    assertEquals(mock.calls.length, 2);
  });

  test("shares one in-flight request between concurrent identical calls", async () => {
    let release: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => (release = resolve));
    const mock = new MockTransport(() => gate);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });

    const first = transport.request("info", { type: "perpDexs" });
    const second = transport.request("info", { type: "perpDexs" });
    assertEquals(mock.calls.length, 1); // the second call joined the in-flight first

    release!(["dex-a"]);
    assertEquals(await first, ["dex-a"]);
    assertEquals(await second, ["dex-a"]);
  });

  test("evicts a rejected request so the next call retries instead of serving the failure", async () => {
    let failures = 1;
    const mock = new MockTransport((_endpoint, payload) => {
      if (failures > 0) {
        failures--;
        throw new Error("network down");
      }
      return { echo: payload };
    });
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });

    await assertRejects(() => transport.request("info", { type: "outcomeMeta" }));
    const retried = await transport.request("info", { type: "outcomeMeta" });

    assertEquals(mock.calls.length, 2);
    assertEquals(retried, { echo: { type: "outcomeMeta" } });
    await transport.request("info", { type: "outcomeMeta" }); // success is cached now
    assertEquals(mock.calls.length, 2);
  });

  test("clear() drops every cached entry", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });

    await transport.request("info", { type: "meta" });
    await transport.request("info", { type: "tokenDetails", tokenId: "0x1" });
    assertEquals(mock.calls.length, 2);

    transport.clear();
    await transport.request("info", { type: "meta" });
    await transport.request("info", { type: "tokenDetails", tokenId: "0x1" });
    assertEquals(mock.calls.length, 4);
  });

  test("evicts the oldest entries beyond maxSize", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000, maxSize: 2 });

    await transport.request("info", { type: "tokenDetails", tokenId: "0x1" });
    time.tick(1); // distinct insertion order for oldest-first eviction
    await transport.request("info", { type: "tokenDetails", tokenId: "0x2" });
    time.tick(1);
    await transport.request("info", { type: "tokenDetails", tokenId: "0x3" }); // evicts 0x1

    await transport.request("info", { type: "tokenDetails", tokenId: "0x3" }); // cached
    await transport.request("info", { type: "tokenDetails", tokenId: "0x2" }); // cached
    assertEquals(mock.calls.length, 3);

    await transport.request("info", { type: "tokenDetails", tokenId: "0x1" }); // evicted: refetch
    assertEquals(mock.calls.length, 4);
  });

  test("caches every allowlisted type", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { ttl: 60_000 });
    const types = [
      "meta",
      "spotMeta",
      "allPerpMetas",
      "perpDexs",
      "marginTable",
      "tokenDetails",
      "outcomeMeta",
      "outcomeTemplates",
    ];

    for (const type of types) await transport.request("info", { type });
    for (const type of types) await transport.request("info", { type });
    assertEquals(mock.calls.length, types.length); // one network call per type, not two
  });

  test("rejects invalid options", () => {
    const mock = new MockTransport(echoHandler);
    assertThrows(() => new InfoCacheTransport(mock, { ttl: -1 }), RangeError);
    assertThrows(() => new InfoCacheTransport(mock, { ttl: Number.NaN }), RangeError);
    assertThrows(() => new InfoCacheTransport(mock, { ttlByType: { meta: -5 } }), RangeError);
    assertThrows(() => new InfoCacheTransport(mock, { maxSize: 0 }), RangeError);
    assertThrows(() => new InfoCacheTransport(mock, { maxSize: 1.5 }), RangeError);
  });

  test("mirrors the wrapped transport's isTestnet flag", () => {
    const mock = new MockTransport(echoHandler);
    assertEquals(new InfoCacheTransport(mock).isTestnet, mock.isTestnet);
  });
});

/** A transport whose responses stay pending until the test settles them, and which honors aborts. */
class DeferredTransport implements IRequestTransport<Endpoint> {
  readonly isTestnet = true;
  readonly calls: {
    payload: unknown;
    signal?: AbortSignal;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];

  request<T>(_endpoint: Endpoint, payload: unknown, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.calls.push({ payload, signal, resolve: resolve as (value: unknown) => void, reject });
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }
}

describe("InfoCacheTransport coalescing", () => {
  test("concurrent identical requests share one network call and one response", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });

    const a = transport.request("info", { type: "l2Book", coin: "BTC" });
    const b = transport.request("info", { coin: "BTC", type: "l2Book" }); // key order is irrelevant
    assertEquals(mock.calls.length, 1);

    const response = { levels: [] };
    mock.calls[0].resolve(response);
    const [ra, rb] = await Promise.all([a, b]);
    assertEquals(ra === response && rb === response, true);
  });

  test("keeps nothing once the request settles", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });

    const first = transport.request("info", { type: "l2Book", coin: "BTC" });
    mock.calls[0].resolve({ n: 1 });
    await first;

    const second = transport.request("info", { type: "l2Book", coin: "BTC" });
    assertEquals(mock.calls.length, 2);
    mock.calls[1].resolve({ n: 2 });
    assertEquals(await second, { n: 2 });
  });

  test("does not coalesce different params, unlisted types, or non-info endpoints", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });

    transport.request("info", { type: "l2Book", coin: "BTC" });
    transport.request("info", { type: "l2Book", coin: "ETH" });
    transport.request("info", { type: "allMids" });
    transport.request("info", { type: "allMids" });
    transport.request("exchange", { type: "l2Book", coin: "BTC" });
    assertEquals(mock.calls.length, 5);
  });

  test("coalesce: true covers every info request type", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: true });

    transport.request("info", { type: "allMids" });
    transport.request("info", { type: "allMids" });
    transport.request("info", { type: "clearinghouseState", user: "0x1" });
    transport.request("info", { type: "clearinghouseState", user: "0x1" });
    assertEquals(mock.calls.length, 2);
  });

  test("is disabled by default", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock);

    transport.request("info", { type: "l2Book", coin: "BTC" });
    transport.request("info", { type: "l2Book", coin: "BTC" });
    assertEquals(mock.calls.length, 2);
  });

  test("a rejection reaches every waiter, and the next call retries", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });

    const a = transport.request("info", { type: "l2Book", coin: "BTC" });
    const b = transport.request("info", { type: "l2Book", coin: "BTC" }, new AbortController().signal);
    mock.calls[0].reject(new Error("boom"));
    await assertRejects(() => a, Error, "boom");
    await assertRejects(() => b, Error, "boom");

    transport.request("info", { type: "l2Book", coin: "BTC" });
    assertEquals(mock.calls.length, 2);
  });

  test("one waiter aborting detaches only that waiter", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });
    const aborter = new AbortController();

    const a = transport.request("info", { type: "l2Book", coin: "BTC" }, aborter.signal);
    const b = transport.request("info", { type: "l2Book", coin: "BTC" }, new AbortController().signal);
    aborter.abort(new Error("caller a gave up"));

    await assertRejects(() => a, Error, "caller a gave up");
    assertEquals(mock.calls[0].signal?.aborted, false);
    mock.calls[0].resolve({ ok: true });
    assertEquals(await b, { ok: true });
  });

  test("the shared request is aborted once every waiter has aborted, and later calls start fresh", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });
    const first = new AbortController();
    const second = new AbortController();

    const a = transport.request("info", { type: "l2Book", coin: "BTC" }, first.signal);
    const b = transport.request("info", { type: "l2Book", coin: "BTC" }, second.signal);
    first.abort(new Error("a"));
    assertEquals(mock.calls[0].signal?.aborted, false);
    second.abort(new Error("b"));
    assertEquals(mock.calls[0].signal?.aborted, true);
    await assertRejects(() => a, Error, "a");
    await assertRejects(() => b, Error, "b");

    transport.request("info", { type: "l2Book", coin: "BTC" });
    assertEquals(mock.calls.length, 2);
  });

  test("a waiter without a signal keeps the shared request alive", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });
    const aborter = new AbortController();

    const a = transport.request("info", { type: "l2Book", coin: "BTC" }, aborter.signal);
    const pinned = transport.request("info", { type: "l2Book", coin: "BTC" });
    aborter.abort(new Error("a"));

    await assertRejects(() => a, Error, "a");
    assertEquals(mock.calls[0].signal?.aborted, false);
    mock.calls[0].resolve({ ok: true });
    assertEquals(await pinned, { ok: true });
  });

  test("an already-aborted signal rejects without starting or joining a request", async () => {
    const mock = new DeferredTransport();
    const transport = new InfoCacheTransport(mock, { coalesce: ["l2Book"] });
    const reason = new Error("already aborted");

    await assertRejects(
      () => transport.request("info", { type: "l2Book", coin: "BTC" }, AbortSignal.abort(reason)),
      Error,
      "already aborted",
    );
    assertEquals(mock.calls.length, 0);
  });

  test("TTL-cacheable types keep their TTL caching", async () => {
    const mock = new MockTransport(echoHandler);
    const transport = new InfoCacheTransport(mock, { coalesce: true });

    await transport.request("info", { type: "meta" });
    await transport.request("info", { type: "meta" });
    assertEquals(mock.calls.length, 1);
  });

  test("rejects an invalid coalesce option", () => {
    const mock = new MockTransport(echoHandler);
    assertThrows(
      () => new InfoCacheTransport(mock, { coalesce: "l2Book" as unknown as string[] }),
      TypeError,
      "coalesce must be",
    );
  });
});
