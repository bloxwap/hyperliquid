/**
 * End-to-end checks for injected transport runtimes: HTTP and WebSocket transports built on
 * their own virtual clocks, fetch, and socket factories run side by side without touching any
 * global, while the coordination that must stay shared (per-signer nonces and the default
 * per-network WebSocket quota) is not silently forked by the injection.
 * @module
 */

import { expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { ExchangeClient, HttpTransport, WebSocketQuota, WebSocketTransport } from "@bloxwap/hyperliquid";
import { FakeRuntime, drain } from "../_fakeRuntime.ts";
import { FakeSocket } from "../_fakeSocket.ts";

const OK = { status: "ok", response: { type: "default" } };

/** Minimal viem local-account shape: callable `signTypedData` plus a string address. */
const wallet = {
  address: "0x5f3c2a4b6d8e0f1a3c5e7b9d1f2a4c6e8b0d2f4a" as const,
  signTypedData: async (): Promise<`0x${string}`> => `0x${"11".repeat(64)}1b` as `0x${string}`,
};

/** A WebSocket transport on `clock` whose socket answers every `post` with `OK`. */
function webSocketOn(clock: FakeRuntime, quota?: WebSocketQuota, nonces?: number[]) {
  const socket = new FakeSocket((data) => {
    const frame = JSON.parse(data);
    if (frame.method !== "post") return;
    nonces?.push(frame.request.payload.nonce);
    queueMicrotask(() =>
      socket.receive({ channel: "post", data: { id: frame.id, response: { type: "action", payload: OK } } }),
    );
  });
  const transport = new WebSocketTransport({
    isTestnet: true,
    runtime: clock,
    quota,
    webSocketFactory: () => socket as unknown as WebSocket,
  });
  return { transport, socket };
}

test("HTTP and WebSocket clients on separate fake runtimes still share per-signer nonces", async () => {
  const globalFetch = globalThis.fetch;
  const globalWebSocket = globalThis.WebSocket;
  const nonces: number[] = [];

  const httpClock = new FakeRuntime();
  const http = new HttpTransport({
    isTestnet: true,
    runtime: httpClock,
    fetch: async (_url, init) => {
      nonces.push(JSON.parse(init!.body as string).nonce);
      return new Response(JSON.stringify(OK), { headers: { "Content-Type": "application/json" } });
    },
  });

  const wsClock = new FakeRuntime();
  const quota = new WebSocketQuota({ runtime: wsClock });
  const { transport: ws, socket } = webSocketOn(wsClock, quota, nonces);
  await drain();
  socket.open();

  try {
    const clients = [new ExchangeClient({ transport: http, wallet }), new ExchangeClient({ transport: ws, wallet })];
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => clients[i % 2].updateLeverage({ asset: 0, isCross: true, leverage: 5 })),
    );
    // One process-wide nonce source per signer/network: the injected clocks never fork it.
    expect(nonces).toHaveLength(6);
    expect(new Set(nonces).size).toBe(6);
  } finally {
    await ws.close();
  }

  // Close released the keep-alive and reconnect timers. A TimeoutWheel may keep its one covered
  // (unref'd) timer until the default 10 s request deadline passes, then nothing remains.
  httpClock.advance(10_000);
  wsClock.advance(10_000);
  expect(httpClock.pendingTimers).toBe(0);
  expect(wsClock.pendingTimers).toBe(0);
  expect(globalThis.fetch).toBe(globalFetch);
  expect(globalThis.WebSocket).toBe(globalWebSocket);
});

test("keep-alive pings and request timeouts run on the injected WebSocket clock", async () => {
  const clock = new FakeRuntime();
  const quota = new WebSocketQuota({ runtime: clock });
  const socket = new FakeSocket();
  const ws = new WebSocketTransport({
    runtime: clock,
    quota,
    timeout: 1_000,
    webSocketFactory: () => socket as unknown as WebSocket,
  });
  await drain();
  socket.open();

  clock.advance(5_000); // default keep-alive interval
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ method: "ping" });

  const signal = new AbortController().signal;
  const pending = ws.request("info", { type: "allMids" }, signal).catch((e: unknown) => e);
  await drain();
  clock.advance(999);
  await drain();
  socket.receive({ channel: "pong" });
  clock.advance(1); // the request timeout fires on the virtual clock, not a real one
  const error = await pending;
  expect((error as Error).message).toContain("timed out");
  expect(getEventListeners(signal, "abort")).toHaveLength(0);

  await ws.close();
  expect(clock.pendingTimers).toBe(0);
});

test("injecting a runtime or socket factory keeps the default shared quota", async () => {
  const first = webSocketOn(new FakeRuntime());
  const second = webSocketOn(new FakeRuntime());
  const isolated = webSocketOn(new FakeRuntime(), new WebSocketQuota());
  try {
    // Same network, no explicit quota: both draw from one per-IP budget despite separate runtimes.
    expect(first.transport.quota).toBe(second.transport.quota);
    expect(isolated.transport.quota).not.toBe(first.transport.quota);
  } finally {
    await Promise.all([first, second, isolated].map(({ transport }) => transport.close()));
  }
});
