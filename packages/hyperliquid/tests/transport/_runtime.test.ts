/**
 * Tests for injectable transport runtimes: isolation from globals, deterministic jitter, timer
 * and abort-listener cleanup, and wall-clock versus monotonic semantics.
 * @module
 */

import { expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { HttpTransport } from "../../src/transport/http/mod.ts";
import { InfoCacheTransport } from "../../src/transport/_infoCache.ts";
import { TimeoutWheel } from "../../src/transport/_abort.ts";
import { TokenBucketRateLimiter } from "../../src/transport/_rateLimiter.ts";
import { ReconnectingWebSocket } from "../../src/transport/websocket/_reconnectingSocket.ts";
import { createNonceManager } from "../../src/api/exchange/_methods/_base/_nonce.ts";
import { delay, resolveRuntime, systemRuntime } from "../../src/transport/runtime.ts";
import { FakeRuntime, drain } from "../_fakeRuntime.ts";
import { FakeSocket } from "../_fakeSocket.ts";

test("HTTP fetch/clock injection isolates simultaneous transports and retry cancellation releases timers", async () => {
  const globalFetch = globalThis.fetch;
  const clock = new FakeRuntime();
  let firstCalls = 0;
  const first = new HttpTransport({
    runtime: clock,
    retryOnRateLimit: true,
    timeout: 1000,
    fetch: async () => {
      firstCalls++;
      return new Response("limited", { status: 429, headers: { "Retry-After": "10" } });
    },
  });
  const second = new HttpTransport({
    runtime: new FakeRuntime(),
    timeout: null,
    fetch: async () => new Response('{"BTC":"1"}', { headers: { "Content-Type": "application/json" } }),
  });
  const abort = new AbortController();
  const pending = first.request("info", {}, abort.signal).catch((e: unknown) => e);
  await drain();
  expect(firstCalls).toBe(1);
  expect(await second.request<Record<string, string>>("info", {})).toEqual({ BTC: "1" });
  abort.abort(new Error("stop"));
  expect(await pending).toBeInstanceOf(Error);
  // TimeoutWheel may retain its covered unref timer until its deadline; the retry delay is gone.
  clock.advance(1000);
  expect(clock.pendingTimers).toBe(0);
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  expect(globalThis.fetch).toBe(globalFetch);
});

test("monotonic deadlines/refill ignore wall-clock rollback; nonce timestamps remain wall based", async () => {
  const clock = new FakeRuntime();
  const wheel = new TimeoutWheel(clock);
  const abort = new AbortController();
  wheel.schedule(abort, 10);
  const bucket = new TokenBucketRateLimiter(1, 60, clock);
  await bucket.acquire(1);
  const waiting = bucket.acquire(1);
  const nonce = createNonceManager(10, clock);
  const before = nonce.getNonce("wallet");
  clock.setWallTime(before - 100_000);
  clock.advance(10);
  expect(abort.signal.aborted).toBe(true);
  expect(nonce.getNonce("wallet")).toBe(before + 1);
  clock.advance(990);
  await waiting;
  expect(clock.pendingTimers).toBe(0);
});

test("cache expiry and abortable delays run on an isolated clock", async () => {
  const clock = new FakeRuntime();
  let calls = 0;
  const inner = { isTestnet: true, request: async <T>(): Promise<T> => ++calls as T };
  const cache = new InfoCacheTransport(inner, { runtime: clock, ttl: 10 });
  await cache.request("info", { type: "meta" });
  await cache.request("info", { type: "meta" });
  expect(calls).toBe(1);
  clock.setWallTime(clock.now() - 100_000);
  clock.advance(10);
  await cache.request("info", { type: "meta" });
  expect(calls).toBe(2);
  const abort = new AbortController();
  const pending = delay(10, clock, abort.signal).catch((e: unknown) => e);
  abort.abort("stop");
  expect(await pending).toBe("stop");
  expect(clock.pendingTimers).toBe(0);
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
});

test("injected socket factories and reconnect timers do not replace global WebSocket", async () => {
  const original = globalThis.WebSocket;
  const clock = new FakeRuntime();
  const sockets: EventTarget[] = [];
  const ws = new ReconnectingWebSocket("wss://test.invalid", {
    runtime: clock,
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    connectionTimeout: 10,
    reconnectionDelay: 5,
  });
  await drain();
  expect(sockets).toHaveLength(1);
  clock.advance(10);
  await drain();
  expect(sockets).toHaveLength(1);
  clock.advance(5);
  await drain();
  expect(sockets).toHaveLength(2);
  ws.close();
  expect(clock.pendingTimers).toBe(0);
  expect(globalThis.WebSocket).toBe(original);
});

test("HTTP retry jitter, timeouts, success, and failure clean up without sleeping", async () => {
  const clock = new FakeRuntime();
  let attempts = 0;
  const transport = new HttpTransport({
    runtime: clock,
    timeout: null,
    retryOnRateLimit: true,
    fetch: async () => {
      attempts++;
      return attempts === 1
        ? new Response("limited", { status: 429 })
        : new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } });
    },
  });
  const abort = new AbortController();
  const retried = transport.request("info", {}, abort.signal);
  await drain();
  expect(attempts).toBe(1);
  expect(clock.pendingTimers).toBe(1);
  clock.nextTimer();
  await retried;
  expect(attempts).toBe(2);
  expect(clock.pendingTimers).toBe(0);
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  const failing = new HttpTransport({
    runtime: clock,
    timeout: 10,
    fetch: async () => {
      throw new Error("offline");
    },
  });
  await expect(failing.request("info", {}, abort.signal)).rejects.toThrow("offline");
  clock.advance(10);
  expect(clock.pendingTimers).toBe(0);
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  const hanging = new HttpTransport({
    runtime: clock,
    timeout: 10,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  });
  const timedOut = hanging.request("info", {}, abort.signal).catch((e: unknown) => e);
  clock.advance(10);
  const error = await timedOut;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("timed out");
  expect(clock.pendingTimers).toBe(0);
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
});

test("resolveRuntime returns the platform runtime when nothing is overridden and is idempotent", () => {
  expect(resolveRuntime()).toBe(systemRuntime);
  expect(resolveRuntime(systemRuntime)).toBe(systemRuntime);
  const clock = new FakeRuntime();
  const resolved = resolveRuntime(clock);
  expect(resolveRuntime(resolved)).toBe(resolved); // shared by a transport's components as one object
  // Overrides keep their receiver; omitted members fall back to the platform.
  const partial = resolveRuntime({ random: () => 0.25 });
  expect(partial.random()).toBe(0.25);
  expect(partial.now).toBe(systemRuntime.now);
  clock.advance(7);
  expect(resolved.monotonicNow()).toBe(7);
});

test("injected random makes backoff jitter exact", async () => {
  const clock = new FakeRuntime({ random: () => 0.5 });
  let attempts = 0;
  const transport = new HttpTransport({
    runtime: clock,
    timeout: null,
    retryOnRateLimit: true,
    fetch: async () => {
      attempts++;
      return attempts < 3
        ? new Response("limited", { status: 429 })
        : new Response("{}", { headers: { "Content-Type": "application/json" } });
    },
  });
  const pending = transport.request("info", {});
  await drain();
  clock.advance(499); // attempt 0 waits 0.5 * 1 s
  await drain();
  expect(attempts).toBe(1);
  clock.advance(1);
  await drain();
  expect(attempts).toBe(2);
  clock.advance(999); // attempt 1 waits 0.5 * 2 s
  await drain();
  expect(attempts).toBe(2);
  clock.advance(1);
  await pending;
  expect(attempts).toBe(3);
  expect(clock.pendingTimers).toBe(0);
});

test("HTTP-date Retry-After is measured against the injected wall clock", async () => {
  const clock = new FakeRuntime();
  let attempts = 0;
  const retryAt = new Date(clock.now() + 3_000).toUTCString(); // whole seconds: up to 1 s sooner
  const transport = new HttpTransport({
    runtime: clock,
    timeout: null,
    retryOnRateLimit: true,
    fetch: async () =>
      ++attempts === 1
        ? new Response("limited", { status: 429, headers: { "Retry-After": retryAt } })
        : new Response("{}", { headers: { "Content-Type": "application/json" } }),
  });
  const pending = transport.request("info", {});
  await drain();
  clock.advance(1_999); // at least 2 s remain on the virtual wall clock, whatever the real date
  await drain();
  expect(attempts).toBe(1);
  clock.advance(1_001);
  await pending;
  expect(attempts).toBe(2);
});

test("the platform delay timer is unref'd, so a pending retry wait never holds the process open", async () => {
  const original = globalThis.setTimeout;
  let timer: { hasRef?: () => boolean } | undefined;
  globalThis.setTimeout = ((callback: () => void, ms: number) => {
    const handle = original(callback, ms);
    timer = handle as unknown as { hasRef?: () => boolean };
    return handle;
  }) as typeof setTimeout;
  const abort = new AbortController();
  let pending: Promise<unknown>;
  try {
    pending = delay(60_000, systemRuntime, abort.signal).catch((e: unknown) => e);
  } finally {
    globalThis.setTimeout = original;
  }
  expect(timer?.hasRef?.()).toBe(false);
  abort.abort("done");
  expect(await pending).toBe("done");
});
