/** Guarded immutable-action weight reuse must bill the exact outgoing JSON. @module */
import { expect, test } from "bun:test";
import { immutableCopy } from "../../src/actions/_canonical.ts";
import { buildOrder } from "../../src/api/exchange/_methods/order.ts";
import {
  exchangeWireJSON,
  type ExchangeWireWeight,
  registerExchangeWireRequest,
  registerImmutableWireAction,
} from "../../src/transport/_wire.ts";
import { HttpTransport } from "../../src/transport/http/mod.ts";
import { drain, FakeRuntime } from "../_fakeRuntime.ts";

const order = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };
const signature = (): { r: string; s: string; v: number } => ({ r: "0x11", s: "0x22", v: 27 });
function request(action = buildOrder({ orders: Array.from({ length: 1000 }, () => order) }).payload) {
  const payload = { action, signature: signature(), nonce: 1_700_000_000_000 };
  registerExchangeWireRequest(payload, action);
  return payload;
}

/** A follow-up minimum-weight request proves that exactly the bucket capacity was spent. */
async function assertWeight(payload: unknown, weight: number): Promise<string> {
  const runtime = new FakeRuntime();
  const sent: string[] = [];
  const transport = new HttpTransport({
    runtime,
    timeout: null,
    rateLimit: { capacity: weight, refillPerMinute: 60 },
    fetch: async (_input, init) => {
      sent.push(init!.body as string);
      return Response.json({ ok: true });
    },
  });
  await transport.request("exchange", payload);
  const next = transport.request("exchange", { action: { type: "noop" } });
  await drain();
  expect(sent).toHaveLength(1);
  runtime.advance(999);
  await drain();
  expect(sent).toHaveLength(1);
  runtime.advance(1);
  await next;
  expect(sent).toHaveLength(2);
  return sent[0];
}

test("rate-limited repeated owned actions parse their action fragment only once across fresh envelopes", async () => {
  const action = buildOrder({ orders: Array.from({ length: 1000 }, () => order) }).payload;
  const actionJSON = JSON.stringify(action);
  const parse = JSON.parse;
  const parsed: string[] = [];
  const bodies: string[] = [];
  const transport = new HttpTransport({
    timeout: null,
    rateLimit: { capacity: 1000, refillPerMinute: 1000 },
    fetch: async (_input, init) => {
      bodies.push(init!.body as string);
      return Response.json({ ok: true });
    },
  });
  JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown => {
    if (text.includes('"orders"')) parsed.push(text);
    return parse(text, reviver);
  }) as typeof JSON.parse;
  try {
    for (let i = 0; i < 10; i++) {
      const payload = request(action);
      payload.nonce += i;
      await transport.request("exchange", payload);
    }
  } finally {
    JSON.parse = parse;
  }
  expect(parsed).toEqual([actionJSON]);
  expect(bodies).toHaveLength(10);
  expect(new Set(bodies).size).toBe(10);
});

test("a cached hint is discarded when a formerly owned envelope no longer passes its guards", () => {
  const payload = request();
  const billing: ExchangeWireWeight = {};
  expect(exchangeWireJSON(payload, billing)).toBe(JSON.stringify(payload));
  expect(billing.weight).toBe(26);
  payload.action = { type: "noop" };
  expect(exchangeWireJSON(payload, billing)).toBeUndefined();
  expect(billing.weight).toBeUndefined();
});

test("cached owned actions retain nested-array and multisig billing", async () => {
  await assertWeight(request(), 26);
  const nested = immutableCopy({
    type: "future",
    items: Array.from({ length: 8 }, () => 0),
    payload: { items: Array.from({ length: 81 }, () => 0) },
  });
  registerImmutableWireAction(nested);
  await assertWeight(request(nested), 3);
  const multisig = immutableCopy({
    type: "multiSig",
    signatures: Array.from({ length: 100 }, () => signature()),
    payload: { action: { type: "order", orders: Array.from({ length: 41 }, () => order) } },
  });
  registerImmutableWireAction(multisig);
  await assertWeight(request(multisig), 2);
});

test("replacement actions, accessors, toJSON, and proxies fall back to billing the sent snapshot", async () => {
  const replaced = request();
  exchangeWireJSON(replaced, {});
  replaced.action = { type: "order", orders: Array.from({ length: 41 }, () => order) };
  await assertWeight(replaced, 2);

  const accessor = request();
  let nonceReads = 0;
  Object.defineProperty(accessor, "nonce", { enumerable: true, get: () => ++nonceReads });
  await assertWeight(accessor, 26);
  expect(nonceReads).toBe(1);

  const hook = request();
  let hookCalls = 0;
  Object.defineProperty(hook, "toJSON", {
    value: () => {
      hookCalls++;
      return { action: { type: "order", orders: Array.from({ length: 41 }, () => order) } };
    },
  });
  await assertWeight(hook, 2);
  expect(hookCalls).toBe(1);

  const live = request();
  Object.defineProperty(live.signature, "toJSON", {
    value: () => {
      live.action = { type: "noop" };
      return signature();
    },
  });
  const body = await assertWeight(live, 26);
  expect(JSON.parse(body).action.orders).toHaveLength(1000);
  expect(live.action).toEqual({ type: "noop" });

  let actionReads = 0;
  const proxy = new Proxy(request(), {
    get(target, property, receiver) {
      if (property === "action") {
        actionReads++;
        return { type: "order", orders: Array.from({ length: 41 }, () => order) };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  await assertWeight(proxy, 2);
  expect(actionReads).toBe(1);
});

test("prototype toJSON hooks invalidate a previously cached action weight", async () => {
  const payload = request();
  exchangeWireJSON(payload, {});
  Object.defineProperty(Array.prototype, "toJSON", {
    configurable: true,
    value(this: unknown[]) {
      return this.slice(0, 41);
    },
  });
  try {
    const body = await assertWeight(payload, 2);
    expect(JSON.parse(body).action.orders).toHaveLength(41);
  } finally {
    Reflect.deleteProperty(Array.prototype, "toJSON");
  }
});

test("cached weights are charged again on retries and not spent by aborted queued requests", async () => {
  const runtime = new FakeRuntime();
  let sent = 0;
  const payload = request(buildOrder({ orders: Array.from({ length: 41 }, () => order) }).payload);
  const transport = new HttpTransport({
    runtime,
    timeout: null,
    rateLimit: { capacity: 2, refillPerMinute: 60 },
    retryOnRateLimit: { maxRetries: 1 },
    fetch: async () =>
      ++sent === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "1" } }) : Response.json({ ok: true }),
  });
  const pending = transport.request("exchange", payload);
  await drain();
  expect(sent).toBe(1);
  runtime.advance(999);
  await drain();
  expect(sent).toBe(1);
  runtime.advance(1);
  await pending;
  expect(sent).toBe(2);

  const controller = new AbortController();
  const cancelled = transport.request("exchange", request(payload.action), controller.signal).catch((error) => error);
  await drain();
  controller.abort(new Error("cancelled"));
  expect(String(await cancelled)).toContain("Request aborted");
  const live = transport.request("exchange", request(payload.action));
  runtime.advance(2999);
  await drain();
  expect(sent).toBe(2);
  runtime.advance(1);
  await live;
  expect(sent).toBe(3);
});
