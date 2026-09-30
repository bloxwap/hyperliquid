import { afterEach, beforeEach, expect, test } from "bun:test";
import { FakeTime } from "@jsr/std__testing/time";
import { WebSocketQuota, WebSocketTransport } from "@bloxwap/hyperliquid";
import { RealCloseEvent } from "../../_noCloseEvent.ts";

class Socket extends EventTarget {
  static instances: Socket[] = [];
  static fail = false;
  readyState = 0;
  binaryType = "blob";
  bufferedAmount = 0;
  extensions = "";
  protocol = "";
  constructor(readonly url: string) {
    super();
    if (Socket.fail) throw new Error("construction failed");
    Socket.instances.push(this);
  }
  send(_data: unknown): void {}
  // Keep closing sockets alive until finishClose(), just like an asynchronous native close.
  close(): void {
    this.readyState = 2;
  }
  finishClose(): void {
    this.readyState = 3;
    this.dispatchEvent(new RealCloseEvent("close", { code: 1006 }));
  }
}
const original = globalThis.WebSocket;
let time: FakeTime;
const transports: WebSocketTransport[] = [];
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function transport(quota: WebSocketQuota): WebSocketTransport {
  const result = new WebSocketTransport({
    url: "wss://test.local/ws",
    quota,
    reconnect: { connectionTimeout: null, reconnectionDelay: 0 },
  });
  transports.push(result);
  return result;
}
beforeEach(() => {
  time = new FakeTime();
  Socket.instances = [];
  Socket.fail = false;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
});
afterEach(() => {
  for (const t of transports.splice(0)) t.close();
  for (const socket of Socket.instances) socket.finishClose();
  time.restore();
  globalThis.WebSocket = original;
});
test("shared transports queue behind the active cap, including closing sockets", async () => {
  const quota = new WebSocketQuota({ maxConnections: 1 });
  const first = transport(quota);
  transport(quota);
  expect(Socket.instances.length).toBe(1);
  expect(quota.connections).toBe(1);
  first.close();
  await settle();
  expect(Socket.instances.length).toBe(1);
  expect(quota.connections).toBe(1);
  Socket.instances[0].finishClose();
  await settle();
  expect(Socket.instances.length).toBe(2);
  expect(quota.connections).toBe(1);
});
test("initial attempts and retry storms share a strict rolling minute", async () => {
  const quota = new WebSocketQuota({ maxConnections: 10, maxConnectionAttemptsPerMinute: 3 });
  transport(quota);
  transport(quota);
  transport(quota);
  transport(quota);
  expect(Socket.instances.length).toBe(3);
  for (const socket of [...Socket.instances]) socket.finishClose();
  time.tick(0);
  await settle();
  expect(quota.connections).toBe(0);
  time.tick(59_999);
  await settle();
  expect(Socket.instances.length).toBe(3);
  time.tick(1);
  await settle();
  expect(Socket.instances.length).toBe(6);
  expect(quota.connections).toBe(3);
});
test("cancelling queued transports never constructs a socket or spends an attempt", async () => {
  const quota = new WebSocketQuota({ maxConnections: 1, maxConnectionAttemptsPerMinute: 2 });
  const first = transport(quota);
  const waiting = transport(quota);
  waiting.close();
  first.close();
  Socket.instances[0].finishClose();
  await settle();
  expect(Socket.instances.length).toBe(1);
  expect(quota.connections).toBe(0);
  transport(quota);
  expect(Socket.instances.length).toBe(2);
});
test("superseding a queued reconnect cancels its old waiter", async () => {
  const quota = new WebSocketQuota({ maxConnections: 1 });
  const first = transport(quota);
  const waiting = transport(quota);
  waiting.socket.reconnect();
  waiting.socket.reconnect();
  first.close();
  Socket.instances[0].finishClose();
  await settle();
  expect(Socket.instances.length).toBe(2);
  expect(quota.connections).toBe(1);
});
test("construction failures release active reservations but count against the attempt window", async () => {
  const quota = new WebSocketQuota({ maxConnections: 1, maxConnectionAttemptsPerMinute: 1 });
  Socket.fail = true;
  transport(quota);
  expect(quota.connections).toBe(0);
  Socket.fail = false;
  time.tick(0);
  await settle();
  expect(Socket.instances.length).toBe(0);
  time.tick(60_000);
  await settle();
  expect(Socket.instances.length).toBe(1);
  expect(quota.connections).toBe(1);
});
test("connection guards can be disabled and reservations release idempotently", async () => {
  const quota = new WebSocketQuota({ maxConnections: null, maxConnectionAttemptsPerMinute: null });
  for (let i = 0; i < 40; i++) transport(quota);
  expect(Socket.instances.length).toBe(40);
  const release = await quota.acquireConnection();
  release();
  release();
  expect(quota.connections).toBe(40);
  const abort = new AbortController();
  abort.abort("cancel");
  expect(() => quota.acquireConnection(abort.signal)).toThrow();
  expect(() => new WebSocketQuota({ maxConnections: 0 })).toThrow(TypeError);
});
