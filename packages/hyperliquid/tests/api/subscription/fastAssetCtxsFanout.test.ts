import { expect, test, spyOn } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { SubscriptionClient, WebSocketQuota, WebSocketTransport } from "@bloxwap/hyperliquid";
import type { ISubscription, ISubscriptionTransport } from "@bloxwap/hyperliquid/transport";
import type { FastAssetCtxsEvent } from "@bloxwap/hyperliquid/api/subscription";
import {
  fastAssetCtxs,
  _setForceStreamDecompressForTests,
} from "../../../src/api/subscription/_methods/fastAssetCtxs.ts";
import { SubscriptionTracker, trackerFor } from "../../../src/api/subscription/_methods/_base/_tracking.ts";
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

for (const stream of [false, true]) {
  test(`mixed function/client subscriptions share decoding and retain independent leases (${stream ? "stream" : "native"})`, async () => {
    installMockWebSocket();
    _setForceStreamDecompressForTests(stream);
    const transport = createTransport();
    const parse = JSON.parse;
    let decodes = 0;
    const spy = spyOn(JSON, "parse").mockImplementation((text: string) => {
      if (text.startsWith('{"COIN":')) decodes++;
      return parse(text);
    });
    try {
      await transport.ready();
      const client = new SubscriptionClient({ transport });
      const secondClient = new SubscriptionClient({ transport });
      const raw: string[] = [];
      const tracked: string[] = [];
      const other: string[] = [];
      const rawHandle = await fastAssetCtxs({ transport }, (event) => {
        raw.push(event.COIN.markPx!);
        event.COIN.markPx = "changed";
      });
      await client.fastAssetCtxs((event) => tracked.push(event.COIN.markPx!));
      await secondClient.fastAssetCtxs((event) => other.push(event.COIN.markPx!));
      const socket = lastMockWebSocket();
      socket.serverSend({ channel: "fastAssetCtxs", data: data(1) });
      await drain();
      expect(decodes).toBe(1);
      expect(raw).toEqual(["1"]);
      expect(tracked).toEqual(["1"]);
      expect(other).toEqual(["1"]);

      // Tracking teardown covers both clients, while the independent raw lease stays live.
      await client.unsubscribeAll();
      socket.serverSend({ channel: "fastAssetCtxs", data: data(2) });
      await drain();
      expect(decodes).toBe(2);
      expect(raw).toEqual(["1", "2"]);
      expect(tracked).toEqual(["1"]);
      expect(other).toEqual(["1"]);
      await rawHandle.unsubscribe();
      socket.serverSend({ channel: "fastAssetCtxs", data: data(3) });
      await drain();
      expect(decodes).toBe(2);
    } finally {
      spy.mockRestore();
      transport.close();
      _setForceStreamDecompressForTests(false);
      restoreWebSocket();
    }
  });

  test(`fan-out gives the original snapshot to the final remaining recipient (${stream ? "stream" : "native"})`, async () => {
    installMockWebSocket();
    _setForceStreamDecompressForTests(stream);
    const transport = createTransport();
    const parse = JSON.parse;
    let original: FastAssetCtxsEvent | undefined;
    const spy = spyOn(JSON, "parse").mockImplementation((text: string) => {
      const parsed = parse(text);
      if (text.startsWith('{"COIN":')) original = parsed;
      return parsed;
    });
    try {
      await transport.ready();
      const client = new SubscriptionClient({ transport });
      const retireLast = new AbortController();
      let first: FastAssetCtxsEvent | undefined;
      let final: FastAssetCtxsEvent | undefined;
      let retiredCalls = 0;
      await client.fastAssetCtxs((event) => {
        first = event;
        event.COIN.markPx = "changed";
        Object.getOwnPropertyDescriptor(event, "__proto__")!.value.markPx = "changed";
        retireLast.abort();
      });
      await client.fastAssetCtxs((event) => {
        final = event;
      });
      await client.fastAssetCtxs(() => retiredCalls++, { signal: retireLast.signal });
      // Preserve an own __proto__ price record without changing the event's prototype.
      const payload = parse('{"COIN":{"markPx":"1"},"__proto__":{"markPx":"2"}}');
      const encoded = Buffer.from(deflateRawSync(Buffer.from(JSON.stringify(payload)))).toString("base64");
      lastMockWebSocket().serverSend({ channel: "fastAssetCtxs", data: encoded });
      await drain();
      expect(first).not.toBe(original);
      expect(first!.COIN).not.toBe(original!.COIN);
      expect(final).toBe(original);
      expect(final!.COIN.markPx).toBe("1");
      expect(Object.getOwnPropertyDescriptor(final!, "__proto__")!.value.markPx).toBe("2");
      expect(Object.hasOwn(first!, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(first!)).toBe(Object.prototype);
      expect(retiredCalls).toBe(0);
    } finally {
      spy.mockRestore();
      transport.close();
      _setForceStreamDecompressForTests(false);
      restoreWebSocket();
    }
  });
}

for (const retirement of ["unsubscribe", "abort", "failure", "unsubscribeAll"] as const) {
  test(`queued stream frames skip decoding after ${retirement}`, async () => {
    installMockWebSocket();
    _setForceStreamDecompressForTests(true);
    const transport = createTransport();
    const parse = JSON.parse;
    let decodes = 0;
    let deliveries = 0;
    const spy = spyOn(JSON, "parse").mockImplementation((text: string) => {
      if (text.startsWith('{"COIN":')) decodes++;
      return parse(text);
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await transport.ready();
      const client = new SubscriptionClient({ transport });
      const abort = new AbortController();
      const handle = await client.fastAssetCtxs(() => deliveries++, { signal: abort.signal });
      const socket = lastMockWebSocket();
      for (let seq = 0; seq < 20; seq++) socket.serverSend({ channel: "fastAssetCtxs", data: data(seq) });
      // A retired corrupt frame must also be skipped before inflate, without logging a decode error.
      socket.serverSend({ channel: "fastAssetCtxs", data: "invalid" });
      let stopped: Promise<void> | undefined;
      if (retirement === "unsubscribe") stopped = handle.unsubscribe();
      else if (retirement === "abort") abort.abort();
      else if (retirement === "failure") transport.close();
      else stopped = client.unsubscribeAll();
      await stopped;
      await drain();
      expect(decodes).toBe(0);
      expect(deliveries).toBe(0);
      expect(error.mock.calls.length).toBe(0);
      if (retirement !== "failure") {
        const current: string[] = [];
        await client.fastAssetCtxs((event) => current.push(event.COIN.markPx!));
        socket.serverSend({ channel: "fastAssetCtxs", data: data(21) });
        await drain();
        expect(decodes).toBe(1);
        expect(current).toEqual(["21"]);
        expect(deliveries).toBe(0);
      }
    } finally {
      spy.mockRestore();
      error.mockRestore();
      transport.close();
      _setForceStreamDecompressForTests(false);
      restoreWebSocket();
    }
  });
}

test("unsubscribeAll retires a fast feed whose confirmation arrives in a stale tracking epoch", async () => {
  const pending = Promise.withResolvers<ISubscription>();
  let onFrame: ((event: CustomEvent<string>) => void) | undefined;
  let unsubscriptions = 0;
  let deliveries = 0;
  const transport: ISubscriptionTransport = {
    subscribe: <T>(_channel: string, _payload: unknown, listener: (event: CustomEvent<T>) => void) => {
      onFrame = listener as (event: CustomEvent<string>) => void;
      return pending.promise;
    },
  };
  const client = new SubscriptionClient({ transport });
  const handle = client.fastAssetCtxs(() => deliveries++);
  await client.unsubscribeAll();
  pending.resolve({
    unsubscribe: async () => {
      unsubscriptions++;
    },
  });
  await handle;
  onFrame!(new CustomEvent("fastAssetCtxs", { detail: data(1) }));
  await drain();
  expect(unsubscriptions).toBe(1);
  expect(deliveries).toBe(0);
});

test("unsubscribeAll immediately retires pending fast-feed recipients while a raw lease stays live", async () => {
  const pending = Promise.withResolvers<ISubscription>();
  const callbacks = new Set<(event: CustomEvent<string>) => void>();
  let subscriptions = 0;
  let unsubscriptions = 0;
  const transport: ISubscriptionTransport = {
    subscribe: <T>(_channel: string, _payload: unknown, listener: (event: CustomEvent<T>) => void) => {
      callbacks.add(listener as (event: CustomEvent<string>) => void);
      subscriptions++;
      if (subscriptions === 1) return Promise.resolve({ unsubscribe: async () => {} });
      return pending.promise;
    },
  };
  const observed: string[] = [];
  await fastAssetCtxs({ transport }, () => observed.push("raw"));
  const client = new SubscriptionClient({ transport });
  const waiting = client.fastAssetCtxs(() => observed.push("client"));
  await client.unsubscribeAll();
  for (const callback of callbacks) callback(new CustomEvent("fastAssetCtxs", { detail: data(1) }));
  expect(observed).toEqual(["raw"]);
  pending.resolve({
    unsubscribe: async () => {
      unsubscriptions++;
    },
  });
  await waiting;
  expect(unsubscriptions).toBe(1);
});

test("SDK tracking layers forward method retirement to their shared decoder", async () => {
  const callbacks = new Set<(event: CustomEvent<string>) => void>();
  const transport: ISubscriptionTransport = {
    subscribe: <T>(_channel: string, _payload: unknown, listener: (event: CustomEvent<T>) => void) => {
      callbacks.add(listener as (event: CustomEvent<string>) => void);
      return Promise.resolve({ unsubscribe: async () => {} });
    },
  };
  const inner = trackerFor(transport);
  expect(trackerFor(inner)).toBe(inner);
  // Explicitly layered internal wrappers must still forward method-owned teardown hooks.
  const outer = new SubscriptionTracker(inner);
  const observed: string[] = [];
  await fastAssetCtxs({ transport }, () => observed.push("raw"));
  await new SubscriptionClient({ transport: outer }).fastAssetCtxs(() => observed.push("client"));
  await inner.unsubscribeAll();
  for (const callback of callbacks) callback(new CustomEvent("fastAssetCtxs", { detail: data(1) }));
  expect(observed).toEqual(["raw"]);
});
