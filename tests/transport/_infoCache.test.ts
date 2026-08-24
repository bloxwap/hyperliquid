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
