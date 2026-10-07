/**
 * End-to-end bounded dispatch across real HTTP and WebSocket transports, driven by injected
 * `fetch`, socket factory, and `FakeRuntime`: one signer's nonces stay unique across clients, and
 * the nonce bound leaves the WebSocket message budget to the transport.
 * @module
 */

import { expect, test } from "bun:test";

import { buildOrder } from "../../../src/actions/order.ts";
import { ExchangeClient } from "../../../src/api/exchange/client.ts";
import { HttpTransport } from "../../../src/transport/http/mod.ts";
import { WebSocketQuota, WebSocketTransport } from "../../../src/transport/websocket/mod.ts";
import { drain, FakeRuntime } from "../../_fakeRuntime.ts";
import { FakeSocket } from "../../_fakeSocket.ts";

test("HTTP and WebSocket clients share bounded coordination/nonces with multi-sig and vault options", async () => {
  const clock = new FakeRuntime();
  clock.setWallTime(Date.now());
  const requests: { nonce: number; vaultAddress?: string; action: { type: string; signatures?: unknown[] } }[] = [];
  const result = { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } };
  const http = new HttpTransport({
    isTestnet: true,
    runtime: clock,
    timeout: null,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    },
  });
  // A one-message budget: every post after the first drives the bucket into debt.
  const quota = new WebSocketQuota({ runtime: clock, rateLimit: { capacity: 1, refillPerMinute: 60 } });
  let posts = 0;
  const socket = new FakeSocket((data) => {
    const frame = JSON.parse(data);
    if (frame.method !== "post") return;
    posts++;
    requests.push(frame.request.payload);
    queueMicrotask(() =>
      socket.receive({ channel: "post", data: { id: frame.id, response: { type: "action", payload: result } } }),
    );
  });
  const ws = new WebSocketTransport({
    isTestnet: true,
    runtime: clock,
    quota,
    timeout: null,
    reconnect: { stableTimeout: 0 },
    webSocketFactory: () => socket as unknown as WebSocket,
  });
  try {
    await drain();
    socket.open();
    await drain();
    const signer = (hex: string) => ({
      address: `0x${hex.repeat(20)}` as `0x${string}`,
      signTypedData: async () => `0x${"11".repeat(64)}1b` as `0x${string}`,
    });
    const signers = [signer("a1"), signer("a2")] as const;
    const base = {
      signers,
      multiSigUser: `0x${"a3".repeat(20)}` as `0x${string}`,
      dispatchPolicy: { mode: "bounded" as const, maxOvertakes: 1 },
      runtime: clock,
    };
    const clients = [new ExchangeClient({ ...base, transport: http }), new ExchangeClient({ ...base, transport: ws })];
    const action = buildOrder({ orders: [{ a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" } } }] });
    const vaultAddress = `0x${"a4".repeat(20)}`;
    // The clock never advances, so no post can have waited for a refill.
    await Promise.all(Array.from({ length: 6 }, (_, i) => clients[i % 2].execute(action, { vaultAddress })));
    expect(requests).toHaveLength(6);
    expect(new Set(requests.map((request) => request.nonce)).size).toBe(6);
    for (const request of requests) {
      expect(request.vaultAddress).toBe(vaultAddress);
      expect(request.action.type).toBe("multiSig");
      expect(request.action.signatures).toHaveLength(2);
    }
    // Posts were charged to the shared budget without waiting: a subscription frame now has to.
    expect(posts).toBe(3);
    expect(quota.connections).toBe(1);
    expect(quota.acquireSend()).toBeInstanceOf(Promise);
  } finally {
    ws.close();
    clock.advance(10_000);
  }
  expect(clock.pendingTimers).toBe(0);
});
