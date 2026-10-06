/** Wire fragment reuse must preserve native serialization and error snapshots. @module */
import { expect, test } from "bun:test";
import { buildOrder } from "../../src/api/exchange/_methods/order.ts";
import { executeAction, signAction, submitAction } from "../../src/actions/execution.ts";
import { exchangeWireJSON, registerExchangeWireRequest } from "../../src/transport/_wire.ts";
import { HttpTransport, HttpRequestError } from "../../src/transport/http/mod.ts";
import { WebSocketTransport, WebSocketRequestError } from "../../src/transport/websocket/mod.ts";
import { WebSocketQuota } from "../../src/transport/websocket/_quota.ts";

const input = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };
const signature = (): { r: string; s: string; v: number } => ({ r: "0x11", s: "0x22", v: 27 });
function request(count = 100): {
  action: Readonly<Record<string, unknown>>;
  signature: ReturnType<typeof signature>;
  nonce: number;
  vaultAddress?: string;
  expiresAfter?: number;
} {
  const result = {
    action: buildOrder({ orders: Array.from({ length: count }, () => input) }).payload,
    signature: signature(),
    nonce: 1_700_000_000_000,
  };
  registerExchangeWireRequest(result, result.action);
  return result;
}

test("bulk wire reuse matches native JSON with fresh nonces, signatures, optional fields, and escaping", () => {
  const payload = request();
  for (let i = 0; i < 5; i++) {
    payload.nonce++;
    payload.signature.r = `quote"\\\n${i}`;
    payload.signature.v = i % 2 ? 27 : 28;
    payload.vaultAddress = i % 2 ? "0x3333333333333333333333333333333333333333" : undefined;
    payload.expiresAfter = i % 2 ? payload.nonce + 60_000 : undefined;
    expect(exchangeWireJSON(payload)).toBe(JSON.stringify(payload));
  }
  expect(exchangeWireJSON(request(1))).toBeUndefined();
});

test("unregistered values and proxies are declined without extra property reads", () => {
  let reads = 0;
  const foreign = new Proxy(request(), {
    get() {
      reads++;
      throw new Error("getter");
    },
    ownKeys() {
      reads++;
      throw new Error("keys");
    },
  });
  expect(exchangeWireJSON(foreign)).toBeUndefined();
  expect(reads).toBe(0);
  expect(exchangeWireJSON({ ...request() })).toBeUndefined();
});

test("mutated envelopes fall back before invoking getters, custom toJSON, or replacement signatures", () => {
  let calls = 0;
  const payload = request();
  exchangeWireJSON(payload);
  Object.defineProperty(payload, "nonce", {
    enumerable: true,
    configurable: true,
    get: () => {
      calls++;
      return 42;
    },
  });
  expect(exchangeWireJSON(payload)).toBeUndefined();
  expect(calls).toBe(0);
  const second = request();
  Object.defineProperty(second.signature, "toJSON", {
    value: () => {
      calls++;
      second.nonce = 42;
      return signature();
    },
  });
  expect(exchangeWireJSON(second)).toBeUndefined();
  expect(calls).toBe(0);
  const third = request();
  third.signature = new Proxy(signature(), {
    ownKeys() {
      calls++;
      throw new Error("proxy");
    },
  });
  expect(exchangeWireJSON(third)).toBeUndefined();
  expect(calls).toBe(0);
  const fourth = request();
  Object.assign(fourth.signature, { v: 27n });
  // BigInt.toJSON can execute caller code even though the value is a primitive.
  expect(exchangeWireJSON(fourth)).toBeUndefined();
});

test("action replacement, extra fields, reordered properties, and prototype hooks decline cached JSON", () => {
  const payload = request();
  exchangeWireJSON(payload);
  payload.action = structuredClone(payload.action);
  expect(exchangeWireJSON(payload)).toBeUndefined();
  const extra = request();
  Object.assign(extra, { extra: true });
  expect(exchangeWireJSON(extra)).toBeUndefined();
  const reordered = request();
  const action = reordered.action;
  Reflect.deleteProperty(reordered, "action");
  reordered.action = action;
  expect(exchangeWireJSON(reordered)).toBeUndefined();
  const hooks = request();
  for (const prototype of [Object.prototype, Array.prototype]) {
    Object.defineProperty(prototype, "toJSON", { configurable: true, value: () => "hook" });
    try {
      expect(exchangeWireJSON(hooks)).toBeUndefined();
    } finally {
      Reflect.deleteProperty(prototype, "toJSON");
    }
  }
});

test("HTTP sends identical bulk bodies and derives redacted errors from the sent snapshot", async () => {
  const payload = request();
  const bodies: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      bodies.push(await request.text());
      return bodies.length < 3 ? Response.json({ ok: true }) : Response.json({ error: "no" }, { status: 400 });
    },
  });
  const transport = new HttpTransport({ apiUrl: server.url, timeout: null });
  try {
    await transport.request("exchange", payload);
    payload.nonce++;
    await transport.request("exchange", payload);
    payload.nonce++;
    const failure = await transport.request("exchange", payload).catch((error) => error);
    expect(bodies[2]).toBe(JSON.stringify(payload));
    expect(failure).toBeInstanceOf(HttpRequestError);
    expect((failure as HttpRequestError).request).toEqual({ ...JSON.parse(bodies[2]), signature: "0x<redacted>" });
  } finally {
    await server.stop(true);
  }
});

test("WebSocket sends identical envelopes with unique ids and preserves error snapshots", async () => {
  const payload = request();
  const frames: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return undefined;
      return new Response(null, { status: 400 });
    },
    websocket: {
      message(socket, data) {
        frames.push(data.toString());
        const frame = JSON.parse(data.toString());
        socket.send(
          JSON.stringify({
            channel: "post",
            data: {
              id: frame.id,
              response:
                frame.id === 3
                  ? { type: "error", payload: "denied" }
                  : { type: "action", payload: { status: "ok", response: { type: "default" } } },
            },
          }),
        );
      },
    },
  });
  const transport = new WebSocketTransport({
    url: server.url.href.replace("http:", "ws:"),
    keepAlive: { interval: 60_000 },
    timeout: 1000,
    quota: new WebSocketQuota(),
  });
  try {
    await transport.request("exchange", payload);
    payload.nonce++;
    await transport.request("exchange", payload);
    payload.nonce++;
    const failure = await transport.request("exchange", payload).catch((error) => error);
    expect(frames[2]).toBe(JSON.stringify({ method: "post", id: 3, request: { type: "action", payload } }));
    expect(failure).toBeInstanceOf(WebSocketRequestError);
    expect(JSON.stringify((failure as WebSocketRequestError).request)).not.toContain('"r":"0x11"');
  } finally {
    await transport.close();
    await server.stop(true);
  }
});

test("managed execution registers owned envelopes while preserving generic custom transport payloads", async () => {
  const action = buildOrder({ orders: Array.from({ length: 100 }, () => input) });
  let nonce = 1_700_000_000_000;
  const seen: string[] = [];
  const config = {
    wallet: {
      address: "0x1111111111111111111111111111111111111111" as const,
      signTypedData: async () => `0x${"11".repeat(64)}1b` as const,
    },
    nonceManager: () => nonce++,
    transport: {
      isTestnet: true,
      async request<T>(_endpoint: string, payload: unknown): Promise<T> {
        const body = exchangeWireJSON(payload);
        expect(body).toBe(JSON.stringify(payload));
        seen.push(body!);
        return { status: "ok", response: { type: "default" } } as T;
      },
    },
  };
  await executeAction(config, action);
  await executeAction(config, action);
  expect(seen[0]).not.toBe(seen[1]);
});

test("separate sign/submit retains immutable payload ownership, fresh signatures, and cached wire JSON", async () => {
  const params = { orders: Array.from({ length: 100 }, () => structuredClone(input)) };
  const action = buildOrder(params);
  const bodies: string[] = [];
  let nonce = 1_700_000_000_000;
  let signatures = 0;
  const config = {
    wallet: {
      address: "0x1111111111111111111111111111111111111111" as const,
      signTypedData: async () => `0x${(++signatures).toString(16).padStart(128, "0")}1b` as const,
    },
    nonceManager: () => nonce++,
    transport: {
      isTestnet: true,
      async request<T>(_endpoint: string, payload: unknown): Promise<T> {
        const body = exchangeWireJSON(payload);
        expect(body).toBe(JSON.stringify(payload));
        bodies.push(body!);
        return { status: "ok", response: { type: "default" } } as T;
      },
    },
  };
  const first = await signAction(config, action);
  const second = await signAction(config, action);
  expect(bodies).toHaveLength(0);
  expect(first.action).toBe(action.payload);
  expect(second.action).toBe(action.payload);
  expect(first.nonce).not.toBe(second.nonce);
  expect(first.signature).not.toEqual(second.signature);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.signature)).toBe(true);
  expect(Object.isFrozen(first.action.orders)).toBe(true);
  params.orders[0].p = "1";
  expect((first.action.orders as typeof params.orders)[0].p).toBe("30000");
  await submitAction(config, first);
  await submitAction(config, second);
  expect(signatures).toBe(2);
  expect(JSON.parse(bodies[0]).nonce).toBe(first.nonce);
  expect(JSON.parse(bodies[1]).nonce).toBe(second.nonce);
});
