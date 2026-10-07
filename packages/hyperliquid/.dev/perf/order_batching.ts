/**
 * Order batching: throughput, latency, queue depth, and signature/request counts across batch sizes
 * and flush intervals, against per-caller `order()` dispatch.
 * bun .dev/perf/order_batching.ts [--filter burst] [--out /tmp/order-batching.json]
 *
 * Independent callers each place one order, either as a single burst or open-loop at one order per
 * millisecond. Every request is signed with a real secp256k1 key and spends a fixed time on a mock
 * transport. Reported per configuration:
 * - caller latency p50/p99, from enqueue to settled outcome;
 * - throughput, orders over the time from the first arrival to the last outcome;
 * - peak queue depth (`batcher.pending`: queued plus in-flight orders);
 * - signatures, requests, and REST weight (`1 + floor(orders / 40)` per request).
 *
 * Configurations alternate inside every round so machine drift hits each one equally, and each
 * metric is the median over rounds. Numbers are wall-clock timings with real timers and mocks, not
 * production latency.
 * @module
 */
import { writeFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import type { ExchangeConfig } from "../../src/api/exchange/_methods/_base/_config.ts";
import { order } from "../../src/api/exchange/_methods/order.ts";
import { createOrderBatcher } from "../../src/actions/orderBatcher.ts";
import { delay } from "../../src/transport/runtime.ts";

const filterIndex = process.argv.indexOf("--filter");
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : undefined;
const outIndex = process.argv.indexOf("--out");
const rounds = 5;
const orders = 300;
/** Gap between arrivals: `1` is open-loop at 1000 orders/s, `0` submits every order at once. */
const arrivals = [0, 1];
const transportMs = 5;
const batchSizes = [1, 5, 25, 100];
const flushIntervals = [0, 1, 5];
const key = privateKeyToAccount(`0x${"22".repeat(32)}`);
const input = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

const median = (values: number[]): number => percentile(values, 0.5);

interface Sample {
  ordersPerSecond: number;
  p50Ms: number;
  p99Ms: number;
  peakQueue: number;
  signatures: number;
  requests: number;
  weight: number;
}

/** `undefined` batching options measure one `order()` call per caller. */
async function run(batching: { maxBatchSize: number; flushIntervalMs: number } | undefined, arrivalEveryMs: number) {
  let signatures = 0;
  let requests = 0;
  let weight = 0;
  let lastNonce = 0;
  const config: ExchangeConfig = {
    wallet: {
      address: key.address,
      sign: (args) => {
        signatures++;
        return key.sign(args);
      },
      signTypedData: (typedData) => {
        signatures++;
        return key.signTypedData(typedData);
      },
    },
    nonceManager: () => (lastNonce = Math.max(Date.now(), lastNonce + 1)),
    transport: {
      isTestnet: true,
      async request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        const count = (payload as { action: { orders: unknown[] } }).action.orders.length;
        requests++;
        weight += 1 + Math.floor(count / 40);
        await delay(transportMs);
        const statuses = Array.from({ length: count }, (_, i) => ({ resting: { oid: i + 1 } }));
        return { status: "ok", response: { type: "order", data: { statuses } } } as T;
      },
    },
  };
  const batcher = batching && createOrderBatcher(config, batching);
  let outstanding = 0;
  let peakQueue = 0;
  const latencies: number[] = [];
  const calls: Promise<void>[] = [];
  const start = performance.now();
  for (let i = 0; i < orders; i++) {
    const arrived = performance.now();
    outstanding++;
    calls.push(
      (batcher ? batcher.enqueue(input) : order(config, { orders: [input] })).then(() => {
        latencies.push(performance.now() - arrived);
        outstanding--;
      }),
    );
    peakQueue = Math.max(peakQueue, batcher ? batcher.pending : outstanding);
    if (arrivalEveryMs > 0) await delay(arrivalEveryMs);
  }
  await Promise.all(calls);
  const elapsed = performance.now() - start;
  await batcher?.close();
  return {
    ordersPerSecond: (orders * 1000) / elapsed,
    p50Ms: percentile(latencies, 0.5),
    p99Ms: percentile(latencies, 0.99),
    peakQueue,
    signatures,
    requests,
    weight,
  } satisfies Sample;
}

const configs: [string, { maxBatchSize: number; flushIntervalMs: number } | undefined][] = [
  ["direct", undefined],
  ...batchSizes.flatMap((maxBatchSize) =>
    flushIntervals.map((flushIntervalMs): [string, { maxBatchSize: number; flushIntervalMs: number }] => [
      `batch ${maxBatchSize}/${flushIntervalMs}ms`,
      { maxBatchSize, flushIntervalMs },
    ]),
  ),
];

const report: Record<string, unknown>[] = [];
for (const arrivalEveryMs of arrivals) {
  const arrival = arrivalEveryMs ? "1/ms" : "burst";
  if (filter !== undefined && !arrival.includes(filter)) continue;
  const samples = new Map<string, Sample[]>(configs.map(([name]) => [name, []]));
  for (let round = 0; round < rounds; round++) {
    const sequence = round % 2 === 0 ? configs : [...configs].reverse();
    for (const [name, batching] of sequence) samples.get(name)!.push(await run(batching, arrivalEveryMs));
  }
  for (const [name, batching] of configs) {
    const rows = samples.get(name)!;
    const summary: Record<string, unknown> = {
      arrival,
      mode: batching ? "batcher" : "direct",
      maxBatchSize: batching?.maxBatchSize ?? "-",
      flushIntervalMs: batching?.flushIntervalMs ?? "-",
    };
    for (const metric of Object.keys(rows[0]) as (keyof Sample)[]) {
      summary[metric] = Number(median(rows.map((row) => row[metric])).toFixed(2));
    }
    report.push(summary);
  }
}

console.log(`${orders} orders per run, ${transportMs} ms transport, real signing, median of ${rounds} rounds`);
console.table(report);
if (outIndex >= 0) {
  await writeFile(
    process.argv[outIndex + 1],
    JSON.stringify({ runtime: process.versions, orders, transportMs, rounds, report }, null, 2),
  );
}
