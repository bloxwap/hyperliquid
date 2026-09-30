import { expect, test, spyOn } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { SubscriptionClient, WebSocketQuota, WebSocketTransport } from "@bloxwap/hyperliquid";
import type { FastAssetCtxsEvent } from "@bloxwap/hyperliquid/api/subscription";
import { _setForceStreamDecompressForTests } from "../../../src/api/subscription/_methods/fastAssetCtxs.ts";
import { installMockWebSocket, lastMockWebSocket, restoreWebSocket } from "../../perf/_helpers.ts";
function data(seq: number): string {
  return Buffer.from(
    deflateRawSync(Buffer.from(JSON.stringify({ COIN: { markPx: String(seq), midPx: null } }))),
  ).toString("base64");
}
function createTransport(): WebSocketTransport {
  return new WebSocketTransport({ url: "wss://test.local/ws", quota: new WebSocketQuota() });
}
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
for (const stream of [false, true]) {
  test(`fan-out decodes once per frame, preserving mutable isolation (${stream ? "stream" : "native"})`, async () => {
    installMockWebSocket();
    _setForceStreamDecompressForTests(stream);
    const transport = createTransport();
    const parse = JSON.parse;
    let decodes = 0;
    const spy = spyOn(JSON, "parse").mockImplementation((text: string, ...args: unknown[]) => {
      if (text.startsWith('{"COIN":')) decodes++;
      return parse(text, ...(args as []));
    });
    try {
      await transport.ready();
      const client = new SubscriptionClient({ transport });
      const records: FastAssetCtxsEvent[] = [];
      await client.fastAssetCtxs((x) => {
        records.push(x);
        x.COIN.markPx = "mutated";
      });
      for (let i = 0; i < 4; i++)
        await client.fastAssetCtxs((x) => {
          expect(x.COIN.markPx).toBe("1");
          records.push(x);
        });
      const socket = lastMockWebSocket();
      const frame = data(1);
      socket.serverSend({ channel: "fastAssetCtxs", data: frame });
      socket.serverSend({ channel: "fastAssetCtxs", data: frame });
      await drain();
      expect(decodes).toBe(2);
      expect(records.length).toBe(10);
      expect(new Set(records).size).toBe(10);
      expect(new Set(records.map((x) => x.COIN)).size).toBe(10);
    } finally {
      spy.mockRestore();
      transport.close();
      _setForceStreamDecompressForTests(false);
      restoreWebSocket();
    }
  });
}
test("stream fan-out keeps arrival order through corrupt frames and throwing listeners", async () => {
  installMockWebSocket();
  _setForceStreamDecompressForTests(true);
  const transport = createTransport();
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    await transport.ready();
    const client = new SubscriptionClient({ transport });
    const observed: string[] = [];
    await client.fastAssetCtxs(() => {
      throw new Error("listener failed");
    });
    await client.fastAssetCtxs((x) => {
      observed.push(x.COIN.markPx!);
    });
    const socket = lastMockWebSocket();
    for (const frame of [data(1), "invalid", data(2), data(3)])
      socket.serverSend({ channel: "fastAssetCtxs", data: frame });
    await drain();
    expect(observed).toEqual(["1", "2", "3"]);
    expect(error.mock.calls.length).toBe(4);
  } finally {
    error.mockRestore();
    transport.close();
    _setForceStreamDecompressForTests(false);
    restoreWebSocket();
  }
});
test("queued frames respect unsubscribe, cancellation and late joining", async () => {
  installMockWebSocket();
  _setForceStreamDecompressForTests(true);
  const transport = createTransport();
  try {
    await transport.ready();
    const client = new SubscriptionClient({ transport });
    const abort = new AbortController();
    const stopped: string[] = [];
    const cancelled: string[] = [];
    const current: string[] = [];
    const joined: string[] = [];
    const sub = await client.fastAssetCtxs((x) => stopped.push(x.COIN.markPx!));
    await client.fastAssetCtxs((x) => cancelled.push(x.COIN.markPx!), { signal: abort.signal });
    await client.fastAssetCtxs((x) => current.push(x.COIN.markPx!));
    const socket = lastMockWebSocket();
    socket.serverSend({ channel: "fastAssetCtxs", data: data(1) });
    const removed = sub.unsubscribe();
    abort.abort();
    await client.fastAssetCtxs((x) => joined.push(x.COIN.markPx!));
    await removed;
    await drain();
    expect(stopped).toEqual([]);
    expect(cancelled).toEqual([]);
    expect(current).toEqual(["1"]);
    expect(joined).toEqual([]);
    socket.serverSend({ channel: "fastAssetCtxs", data: data(2) });
    await drain();
    expect(current).toEqual(["1", "2"]);
    expect(joined).toEqual(["2"]);
  } finally {
    transport.close();
    _setForceStreamDecompressForTests(false);
    restoreWebSocket();
  }
});
test("reconnects retain local leases and separate transports keep separate decoders", async () => {
  installMockWebSocket();
  const first = createTransport();
  let second: WebSocketTransport | undefined;
  try {
    await first.ready();
    const firstSocket = lastMockWebSocket();
    const firstClient = new SubscriptionClient({ transport: first });
    const a: string[] = [];
    const b: string[] = [];
    const c: string[] = [];
    await firstClient.fastAssetCtxs((x) => a.push(x.COIN.markPx!));
    await firstClient.fastAssetCtxs((x) => b.push(x.COIN.markPx!));
    second = createTransport();
    await second.ready();
    const secondSocket = lastMockWebSocket();
    await new SubscriptionClient({ transport: second }).fastAssetCtxs((x) => c.push(x.COIN.markPx!));
    firstSocket.serverSend({ channel: "fastAssetCtxs", data: data(1) });
    secondSocket.serverSend({ channel: "fastAssetCtxs", data: data(2) });
    expect(a).toEqual(["1"]);
    expect(b).toEqual(["1"]);
    expect(c).toEqual(["2"]);
    first.socket.reconnect();
    await first.ready();
    await drain();
    lastMockWebSocket().serverSend({ channel: "fastAssetCtxs", data: data(3) });
    expect(a).toEqual(["1", "3"]);
    expect(b).toEqual(["1", "3"]);
    expect(c).toEqual(["2"]);
  } finally {
    first.close();
    second?.close();
    restoreWebSocket();
  }
});
test("terminal failures retire queued callbacks and notify each lease once", async () => {
  installMockWebSocket();
  _setForceStreamDecompressForTests(true);
  const transport = createTransport();
  try {
    await transport.ready();
    const client = new SubscriptionClient({ transport });
    let deliveries = 0;
    let errors = 0;
    const handles = [];
    for (let i = 0; i < 2; i++)
      handles.push(
        await client.fastAssetCtxs(
          () => {
            deliveries++;
          },
          {
            onError: () => {
              errors++;
            },
          },
        ),
      );
    lastMockWebSocket().serverSend({ channel: "fastAssetCtxs", data: data(1) });
    transport.close();
    await drain();
    expect(deliveries).toBe(0);
    expect(errors).toBe(2);
    for (const handle of handles) expect(handle.failureSignal.aborted).toBe(true);
  } finally {
    transport.close();
    _setForceStreamDecompressForTests(false);
    restoreWebSocket();
  }
});
