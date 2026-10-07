import { expect, test } from "bun:test";
import { createOrderBatcher } from "../../../src/actions/orderBatcher.ts";
import { FakeRuntime, drain } from "../../_fakeRuntime.ts";

test("cancelled groups and flushed generations cannot inflate subsequent batch thresholds", async () => {
  const clock = new FakeRuntime();
  const sizes: number[] = [];
  const input = { a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" as const } } };
  let nonce = clock.now();
  const batcher = createOrderBatcher(
    {
      wallet: {
        address: "0x7777777777777777777777777777777777777777",
        signTypedData: async () => `0x${"11".repeat(64)}1b`,
      },
      nonceManager: () => nonce++,
      transport: {
        isTestnet: true,
        async request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
          const count = (payload as { action: { orders: unknown[] } }).action.orders.length;
          sizes.push(count);
          return {
            status: "ok",
            response: {
              type: "order",
              data: { statuses: Array.from({ length: count }, () => ({ resting: { oid: 1 } })) },
            },
          } as T;
        },
      },
    },
    { runtime: clock, maxBatchSize: 2, flushIntervalMs: 10 },
  );

  const abort = new AbortController();
  const cancelled = batcher.enqueue(input, { signal: abort.signal }).catch((reason: unknown) => reason);
  const sibling = batcher.enqueue(input, { grouping: { p: 1 } });
  abort.abort(new Error("cancel queued"));
  expect(await cancelled).toBe(abort.signal.reason);
  const first = batcher.enqueue(input);
  await drain();
  expect(sizes).toEqual([]);
  const second = batcher.enqueue(input);
  await drain();
  await Promise.all([first, second, sibling]);
  expect([...sizes].sort()).toEqual([1, 2]);
  const flushedSizes = [...sizes];

  const afterFlush = batcher.enqueue(input);
  await drain();
  expect(sizes).toEqual(flushedSizes);
  clock.advance(10);
  await drain();
  await afterFlush;
  expect(sizes).toEqual([...flushedSizes, 1]);
  expect(batcher.pending).toBe(0);
  await batcher.close();
  expect(clock.pendingTimers).toBe(0);
});
