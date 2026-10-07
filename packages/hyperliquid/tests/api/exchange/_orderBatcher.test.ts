import { expect, test } from "bun:test";
import { createOrderBatcher, type OrderOutcome } from "@bloxwap/hyperliquid/actions/orderBatcher";
import { ApiRequestError, ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import type { ExchangeConfig } from "../../../src/api/exchange/_methods/_base/_config.ts";
import { buildOrder } from "../../../src/api/exchange/_methods/order.ts";
import { FakeRuntime, drain } from "../../_fakeRuntime.ts";

let walletId = 200;
const input = { a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" as const } } };
function harness(handler?: (body: { action: { orders: unknown[] } }) => unknown) {
  const clock = new FakeRuntime();
  const calls: {
    action: { orders: unknown[]; grouping: unknown };
    nonce: number;
    vaultAddress?: string;
    expiresAfter?: number;
  }[] = [];
  let nonce = clock.now();
  let signs = 0;
  const config: ExchangeConfig = {
    wallet: {
      address: `0x${(++walletId).toString(16).padStart(40, "0")}`,
      signTypedData: async () => {
        signs++;
        return `0x${"11".repeat(64)}1b`;
      },
    },
    nonceManager: () => nonce++,
    transport: {
      isTestnet: true,
      request: async <T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> => {
        const body = payload as (typeof calls)[number];
        calls.push(body);
        return (
          handler
            ? await handler(body)
            : {
                status: "ok",
                response: {
                  type: "order",
                  data: { statuses: body.action.orders.map((_, i) => ({ resting: { oid: i + 1 } })) },
                },
              }
        ) as T;
      },
    },
  };
  return { config, clock, calls, signs: () => signs };
}

test("flush batches compatible callers with one signature and one nonce", async () => {
  const { config, clock, calls, signs } = harness();
  const batcher = createOrderBatcher(config, { runtime: clock, maxBatchSize: 100 });
  const results = Array.from({ length: 5 }, () => batcher.enqueue(input));
  expect(calls).toHaveLength(0);
  expect(batcher.pending).toBe(5);
  await batcher.flush();
  expect(await Promise.all(results)).toEqual(Array.from({ length: 5 }, (_, i) => ({ resting: { oid: i + 1 } })));
  expect(calls).toHaveLength(1);
  expect(signs()).toBe(1);
  expect(batcher.pending).toBe(0);
  expect(clock.pendingTimers).toBe(0);
  await batcher.close();
});

test("virtual flush deadline, size threshold, and compatible option partitioning", async () => {
  const { config, clock, calls } = harness();
  const batcher = createOrderBatcher(config, { runtime: clock, flushIntervalMs: 5, maxBatchSize: 2 });
  const first = batcher.enqueue(input);
  clock.advance(4);
  await drain();
  expect(calls).toHaveLength(0);
  clock.advance(1);
  await drain();
  await first;
  expect(calls).toHaveLength(1);
  const second = batcher.enqueue(input);
  const third = batcher.enqueue(input);
  await drain();
  await Promise.all([second, third]);
  expect(calls).toHaveLength(2);
  const grouped = batcher.enqueue(input, { grouping: "normalTpsl" });
  const alo = batcher.enqueue({ ...input, t: { limit: { tif: "Alo" } } });
  const normal = batcher.enqueue(input);
  await batcher.flush();
  await Promise.all([grouped, alo, normal]);
  expect(calls).toHaveLength(5);
});

test("mixed batch errors preserve each success and return typed error outcomes", async () => {
  const { config, clock } = harness(() => ({
    status: "ok",
    response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }, { error: "insufficient margin" }] } },
  }));
  const batcher = createOrderBatcher(config, { runtime: clock });
  const first = batcher.enqueue(input);
  const second = batcher.enqueue(input);
  await batcher.flush();
  expect(await first).toEqual({ resting: { oid: 1 } });
  const error: OrderOutcome = await second;
  expect(error).toEqual({ error: "insufficient margin" });
});

for (const failure of [
  { status: "err", response: "batch rejected" },
  { status: "ok", response: { type: "order", data: { statuses: [] } } },
  { status: "ok", response: { type: "order", data: { statuses: [null, {}] } } },
])
  test("whole batch rejection and cardinality mismatch reject every waiting caller", async () => {
    const { config, clock } = harness(() => failure);
    const batcher = createOrderBatcher(config, { runtime: clock });
    const first = batcher.enqueue(input).catch((e: unknown) => e);
    const second = batcher.enqueue(input).catch((e: unknown) => e);
    await batcher.flush();
    expect(await first).toBeInstanceOf(Error);
    expect(await second).toBeInstanceOf(Error);
    expect(batcher.pending).toBe(0);
  });

test("queue overflow, queued cancellation, and expiry do not strand callers or timers", async () => {
  const { config, clock, calls } = harness();
  const batcher = createOrderBatcher(config, { runtime: clock, maxQueueSize: 1 });
  const abort = new AbortController();
  const queued = batcher.enqueue(input, { signal: abort.signal }).catch((e: unknown) => e);
  await expect(batcher.enqueue(input)).rejects.toThrow("full");
  abort.abort(new Error("withdraw queued"));
  expect(await queued).toBe(abort.signal.reason);
  expect(batcher.pending).toBe(0);
  expect(clock.pendingTimers).toBe(0);
  const expired = batcher.enqueue(input, { expiresAfter: clock.now() + 1 }).catch((e: unknown) => e);
  clock.advance(2);
  await drain();
  expect(await expired).toBeInstanceOf(Error);
  expect(calls).toHaveLength(0);
});

test("post-dispatch cancellation retains capacity and leaves sibling results intact", async () => {
  let respond!: (value: unknown) => void;
  const { config, clock, calls } = harness(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const batcher = createOrderBatcher(config, { runtime: clock, maxQueueSize: 2 });
  const abort = new AbortController();
  const first = batcher.enqueue(input, { signal: abort.signal }).catch((e: unknown) => e);
  const second = batcher.enqueue(input);
  const flushed = batcher.flush();
  await drain();
  expect(calls).toHaveLength(1);
  abort.abort(new Error("stop waiting"));
  expect(await first).toBe(abort.signal.reason);
  expect(batcher.pending).toBe(2);
  await expect(batcher.enqueue(input)).rejects.toThrow("full");
  respond({
    status: "ok",
    response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }, { resting: { oid: 2 } }] } },
  });
  await flushed;
  expect(await second).toEqual({ resting: { oid: 2 } });
  expect(batcher.pending).toBe(0);
});

test("close drains by default; abort close settles queued callers and rejects later enqueues", async () => {
  const { config, clock } = harness();
  const batcher = createOrderBatcher(config, { runtime: clock });
  const queued = batcher.enqueue(input);
  await batcher.close();
  expect(await queued).toEqual({ resting: { oid: 1 } });
  await expect(batcher.enqueue(input)).rejects.toThrow("closed");
  const aborted = createOrderBatcher(config, { runtime: clock });
  const pending = aborted.enqueue(input).catch((e: unknown) => e);
  await aborted.close({ drain: false });
  expect(await pending).toBeInstanceOf(Error);
  expect(clock.pendingTimers).toBe(0);
  expect(aborted.pending).toBe(0);
});

test("incompatible options and order classes are partitioned into separate batches", async () => {
  const { config, clock, calls } = harness();
  const batcher = createOrderBatcher(config, { runtime: clock, flushIntervalMs: 10 });
  const builder = { b: "0x1111111111111111111111111111111111111111" as const, f: 1 };
  const vault = "0x2222222222222222222222222222222222222222" as const;
  const expiresAfter = clock.now() + 60_000;
  const ioc = { ...input, t: { limit: { tif: "Ioc" as const } } };
  const results = [
    batcher.enqueue(input),
    batcher.enqueue(ioc), // GTC and IOC share a batch
    batcher.enqueue({ ...input, t: { limit: { tif: "Alo" } } }),
    batcher.enqueue(input, { builder }),
    batcher.enqueue(input, { vaultAddress: vault }),
    batcher.enqueue(input, { expiresAfter }),
    // Priority grouping requires a homogeneous class: IOC and reduce-only ALO stay apart.
    batcher.enqueue(ioc, { grouping: { p: 1 } }),
    batcher.enqueue(ioc, { grouping: { p: 1 } }),
    batcher.enqueue({ ...input, r: true, t: { limit: { tif: "Alo" } } }, { grouping: { p: 1 } }),
  ];
  await batcher.flush();
  await Promise.all(results);
  expect(calls.map((call) => call.action.orders.length).sort()).toEqual([1, 1, 1, 1, 1, 2, 2]);
  expect(calls.filter((call) => "builder" in call.action)).toHaveLength(1);
  expect(calls.filter((call) => call.vaultAddress === vault)).toHaveLength(1);
  expect(calls.filter((call) => call.expiresAfter === expiresAfter)).toHaveLength(1);
  const priority = calls.filter((call) => typeof call.action.grouping === "object");
  expect(priority.map((call) => call.action.orders.length).sort()).toEqual([1, 2]);
  // One nonce per submitted batch, never per order.
  expect(new Set(calls.map((call) => call.nonce)).size).toBe(calls.length);
});

test("a batch carries the same canonical wire action as one order() call for its orders", async () => {
  const { config, clock, calls } = harness();
  const batcher = createOrderBatcher(config, { runtime: clock });
  const builder = { b: "0xABCDEF0000000000000000000000000000000000" as const, f: 5 };
  const orders = [
    { ...input, p: "30000.50", s: "0.10" },
    { ...input, b: false, c: "0x0123456789abcdef0123456789abcdef" as const },
    {
      a: 1,
      b: true,
      p: "2",
      s: "1",
      r: true,
      t: { trigger: { isMarket: true, triggerPx: "2.0", tpsl: "sl" as const } },
    },
  ];
  const results = orders.map((order) => batcher.enqueue(order, { grouping: "normalTpsl", builder }));
  await batcher.flush();
  await Promise.all(results);
  expect(calls).toHaveLength(1);
  expect(JSON.stringify(calls[0].action)).toBe(
    JSON.stringify(buildOrder({ orders, grouping: "normalTpsl", builder }).payload),
  );
});

test("ExchangeClient.order keeps immediate dispatch and whole-call errors next to an active batcher", async () => {
  const { config, clock, calls } = harness((body) => ({
    status: "ok",
    response: {
      type: "order",
      data: {
        statuses: body.action.orders.map((_, i) => (i === 0 ? { resting: { oid: 1 } } : { error: "rejected" })),
      },
    },
  }));
  const client = new ExchangeClient(config);
  const batcher = createOrderBatcher(config, { runtime: clock, flushIntervalMs: 50 });
  const queued = [batcher.enqueue(input), batcher.enqueue(input)];
  await drain();
  expect(calls).toHaveLength(0);

  expect(await client.order({ orders: [input] })).toMatchObject({ status: "ok" });
  expect(calls).toHaveLength(1);
  expect(batcher.pending).toBe(2);
  const error = await client.order({ orders: [input, input] }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(calls).toHaveLength(2);
  expect(clock.pendingTimers).toBe(1);

  clock.advance(50);
  expect(await Promise.all(queued)).toEqual([{ resting: { oid: 1 } }, { error: "rejected" }]);
  expect(calls).toHaveLength(3);
  await batcher.close();
});

test("HTTP rate limiting charges one batch weight of 1 + floor(n / 40), not one per order", async () => {
  const clock = new FakeRuntime();
  const sizes: number[] = [];
  const transport = new HttpTransport({
    isTestnet: true,
    runtime: clock,
    timeout: null,
    // Three weight, refilled at one per minute.
    rateLimit: { capacity: 3, refillPerMinute: 1 },
    fetch: async (_input, init) => {
      const count = JSON.parse(String(init?.body)).action.orders.length;
      sizes.push(count);
      const statuses = Array.from({ length: count }, (_, i) => ({ resting: { oid: i + 1 } }));
      return new Response(JSON.stringify({ status: "ok", response: { type: "order", data: { statuses } } }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  let nonce = clock.now();
  const config: ExchangeConfig = {
    transport,
    wallet: {
      address: "0x8888888888888888888888888888888888888888",
      signTypedData: async () => `0x${"11".repeat(64)}1b`,
    },
    nonceManager: () => nonce++,
  };
  const batcher = createOrderBatcher(config, { runtime: clock, maxBatchSize: 80 });
  const results = Array.from({ length: 80 }, () => batcher.enqueue(input));
  await Promise.all(results);
  expect(sizes).toEqual([80]);

  // The 80-order batch spent exactly 3 weight: a 1-weight follow-up waits for one refill.
  const followUp = batcher.enqueue(input);
  clock.advance(1);
  await drain();
  expect(sizes).toEqual([80]);
  clock.advance(59_998);
  await drain();
  expect(sizes).toEqual([80]);
  clock.advance(1);
  expect(await followUp).toEqual({ resting: { oid: 1 } });
  expect(sizes).toEqual([80, 1]);
  await batcher.close();
});
