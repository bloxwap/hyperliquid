import { expect, test } from "bun:test";
import { FakeRuntime } from "../_fakeRuntime.ts";
import { InfoCacheTransport } from "../../src/transport/_infoCache.ts";
import type { IRequestTransport } from "../../src/transport/_base.ts";
interface Entry {
  key: string;
  expiresAt: number;
  expiryIndex: number;
  previous?: Entry;
  next?: Entry;
}
function indexes(cache: InfoCacheTransport): { _entries: Map<string, Entry>; _expiry: Entry[] } {
  return cache as unknown as { _entries: Map<string, Entry>; _expiry: Entry[] };
}
function assertBoundedIndex(cache: InfoCacheTransport, bound: number): void {
  let entry = (cache as unknown as { _oldest?: Entry })._oldest;
  let previous: Entry | undefined;
  const keys: string[] = [];
  while (entry !== undefined) {
    expect(entry.previous).toBe(previous);
    keys.push(entry.key);
    expect(keys.length).toBeLessThanOrEqual(bound);
    previous = entry;
    entry = entry.next;
  }
  expect(keys).toEqual([...indexes(cache)._entries.keys()]);
  const { _entries, _expiry } = indexes(cache);
  expect(_entries.size).toBeLessThanOrEqual(bound);
  expect(_expiry.length).toBe([..._entries.values()].filter((entry) => entry.expiresAt !== Infinity).length);
  for (let i = 0; i < _expiry.length; i++) {
    const entry = _expiry[i];
    expect(entry.expiryIndex).toBe(i);
    expect(_entries.get(entry.key)).toBe(entry);
    if (i > 0) expect(_expiry[(i - 1) >> 1].expiresAt).toBeLessThanOrEqual(entry.expiresAt);
  }
}
test("mixed TTL capacity misses evict expired entries before older infinite-TTL entries", async () => {
  const time = new FakeRuntime();
  let calls = 0;
  const inner: IRequestTransport = { isTestnet: false, request: async <T>(): Promise<T> => ++calls as T };
  const cache = new InfoCacheTransport(inner, {
    runtime: time,
    maxSize: 3,
    ttl: Infinity,
    ttlByType: { marginTable: 10 },
  });
  const retained = await cache.request<number>("info", { type: "meta" });
  await cache.request("info", { type: "marginTable", id: 1 });
  await cache.request("info", { type: "marginTable", id: 2 });
  time.advance(10);
  await cache.request("info", { type: "tokenDetails", tokenId: "new" });
  expect(await cache.request<number>("info", { type: "meta" })).toBe(retained);
  expect(calls).toBe(4);
  assertBoundedIndex(cache, 3);
  await cache.request("info", { type: "tokenDetails", tokenId: "next" });
  expect(await cache.request<number>("info", { type: "meta" })).toBe(retained);
  await cache.request("info", { type: "tokenDetails", tokenId: "final" });
  expect(await cache.request<number>("info", { type: "meta" })).not.toBe(retained);
});
test("expiry bookkeeping stays bounded through heterogeneous churn, rejection, overwrite and clear", async () => {
  const time = new FakeRuntime();
  let count = 0;
  const inner: IRequestTransport = {
    isTestnet: false,
    request: async <T>(): Promise<T> => {
      if (++count % 7 === 0) throw new Error("temporary failure");
      return count as T;
    },
  };
  const cache = new InfoCacheTransport(inner, {
    runtime: time,
    maxSize: 31,
    ttl: 100,
    ttlByType: { meta: 10, marginTable: 1000, tokenDetails: Infinity },
  });
  let random = 12345;
  for (let i = 0; i < 2000; i++) {
    random = (random * 1664525 + 1013904223) >>> 0;
    const type = ["meta", "marginTable", "tokenDetails"][random % 3];
    await cache.request("info", { type, id: random % 79 }).catch(() => {});
    time.advance(random % 5);
    if (i % 127 === 0) cache.clear();
    if (i % 13 === 0) assertBoundedIndex(cache, 31);
  }
  assertBoundedIndex(cache, 31);
  cache.clear();
  expect(indexes(cache)._expiry).toHaveLength(0);
});
test("a stale pending rejection cannot remove the replacement entry or its expiry node", async () => {
  const time = new FakeRuntime();
  const pending: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  const inner: IRequestTransport = {
    isTestnet: false,
    request: <T>(): Promise<T> => {
      const request = Promise.withResolvers<unknown>();
      pending.push(request);
      return request.promise as Promise<T>;
    },
  };
  const cache = new InfoCacheTransport(inner, { runtime: time, ttl: 10, maxSize: 2 });
  const payload = { type: "meta" };
  const first = cache.request("info", payload);
  const failed = first.catch((error: unknown) => error);
  time.advance(11);
  const second = cache.request("info", payload);
  pending[0].reject(new Error("old failed"));
  expect(((await failed) as Error).message).toBe("old failed");
  expect(cache.request("info", payload)).toBe(second);
  assertBoundedIndex(cache, 2);
  pending[1].resolve("new value");
  expect(await second).toBe("new value");
  cache.clear();
  assertBoundedIndex(cache, 2);
});
