/**
 * Ordered versus bounded dispatch under variable remote-signing latency.
 * bun .dev/perf/remote_signing.ts [--filter stall] [--out /tmp/remote-signing.json]
 *
 * Orders for one signer arrive either open-loop, one per millisecond, or as a single burst. Each signature takes a seeded random
 * latency from the scenario's profile, standing in for an `eth_signTypedData_v4` round trip to a
 * remote wallet, and each request spends a fixed time on a mock transport. Reported per mode:
 * - caller latency p50/p99, from arrival to settled response;
 * - throughput, orders over the time from the first arrival to the last response;
 * - outstanding work: peak signatures in progress, peak signed requests waiting to dispatch, and
 *   peak requests in flight on the transport.
 *
 * Both modes see the same arrival and latency sequence; modes alternate inside every round so
 * machine drift hits each one equally, and each metric is the median over rounds. Numbers are
 * wall-clock timings with real timers and mocks, not production latency.
 * @module
 */
import { writeFile } from "node:fs/promises";
import type { DispatchPolicy } from "../../src/api/exchange/_methods/_base/_dispatch.ts";
import type { ExchangeConfig } from "../../src/api/exchange/_methods/_base/_config.ts";
import { buildOrder } from "../../src/api/exchange/_methods/order.ts";
import { executeAction } from "../../src/actions/execution.ts";
import { delay } from "../../src/transport/runtime.ts";

const filterIndex = process.argv.indexOf("--filter");
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : undefined;
const outIndex = process.argv.indexOf("--out");
const rounds = 5;
const orders = 300;
/** Gap between arrivals: `1` is open-loop at 1000 orders/s, `0` submits every order at once. */
const arrivals = [1, 0];
const transportMs = 5;
const signature = `0x${"11".repeat(64)}1b` as const;
const action = buildOrder({
  orders: [{ a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }],
});
const response = { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } };

/** Signing-latency profiles, as a function of a uniform random value and the order index. */
const scenarios: Record<string, (u: number, i: number) => number> = {
  // One slow signature at the start, then 2-10 ms with an occasional 50 ms.
  stall: (u, i) => (i === 0 ? 200 : i % 25 === 0 ? 50 : 2 + u * 8),
  // Uniform 1-30 ms.
  jitter: (u) => 1 + u * 29,
  // 90% at 2 ms, 10% at 100 ms.
  heavy_tail: (u) => (u < 0.9 ? 2 : 100),
};

const policies: Record<string, DispatchPolicy> = {
  ordered: "ordered",
  bounded: { mode: "bounded", maxOvertakes: 99 },
};

/** Deterministic PRNG (mulberry32), so both modes see the same latency sequence. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

const median = (values: number[]): number => percentile(values, 0.5);

let walletId = 0x5000;

interface Sample {
  p50Ms: number;
  p99Ms: number;
  ordersPerSecond: number;
  peakSigning: number;
  peakWaiting: number;
  peakInFlight: number;
}

async function run(
  profile: (u: number, i: number) => number,
  policy: DispatchPolicy,
  arrivalEveryMs: number,
  seed: number,
): Promise<Sample> {
  const next = random(seed);
  const latencies = Array.from({ length: orders }, (_, i) => profile(next(), i));
  let signing = 0;
  let waiting = 0;
  let inFlight = 0;
  let peakSigning = 0;
  let peakWaiting = 0;
  let peakInFlight = 0;
  let signed = 0;
  let lastNonce = 0;
  const config: ExchangeConfig = {
    wallet: {
      address: `0x${(++walletId).toString(16).padStart(40, "0")}`,
      async signTypedData(): Promise<`0x${string}`> {
        const i = signed++;
        peakSigning = Math.max(peakSigning, ++signing);
        await delay(latencies[i]);
        signing--;
        peakWaiting = Math.max(peakWaiting, ++waiting);
        return signature;
      },
    },
    // Wall-clock nonces: bounded dispatch checks them against the protocol timestamp window.
    nonceManager: () => (lastNonce = Math.max(Date.now(), lastNonce + 1)),
    dispatchPolicy: policy,
    transport: {
      isTestnet: true,
      async request<T>(): Promise<T> {
        waiting--;
        peakInFlight = Math.max(peakInFlight, ++inFlight);
        await delay(transportMs);
        inFlight--;
        return response as T;
      },
    },
  };
  const callerLatencies: number[] = [];
  const start = performance.now();
  const calls: Promise<void>[] = [];
  for (let i = 0; i < orders; i++) {
    const arrived = performance.now();
    calls.push(
      executeAction(config, action).then(() => {
        callerLatencies.push(performance.now() - arrived);
      }),
    );
    if (arrivalEveryMs > 0) await delay(arrivalEveryMs);
  }
  await Promise.all(calls);
  const elapsed = performance.now() - start;
  return {
    p50Ms: percentile(callerLatencies, 0.5),
    p99Ms: percentile(callerLatencies, 0.99),
    ordersPerSecond: (orders * 1000) / elapsed,
    peakSigning,
    peakWaiting,
    peakInFlight,
  };
}

const report: Record<string, unknown>[] = [];
for (const [scenario, profile] of Object.entries(scenarios)) {
  if (filter !== undefined && !scenario.includes(filter)) continue;
  for (const arrivalEveryMs of arrivals) {
    const samples: Record<string, Sample[]> = { ordered: [], bounded: [] };
    for (let round = 0; round < rounds; round++) {
      const modes = round % 2 === 0 ? ["ordered", "bounded"] : ["bounded", "ordered"];
      for (const mode of modes) samples[mode].push(await run(profile, policies[mode], arrivalEveryMs, round + 1));
    }
    for (const [mode, rows] of Object.entries(samples)) {
      const summary: Record<string, unknown> = { scenario, arrival: arrivalEveryMs ? "1/ms" : "burst", mode };
      for (const key of Object.keys(rows[0]) as (keyof Sample)[]) {
        summary[key] = Number(median(rows.map((row) => row[key])).toFixed(2));
      }
      report.push(summary);
    }
  }
}

console.log(`${orders} orders per run, ${transportMs} ms transport, median of ${rounds} rounds`);
console.table(report);
if (outIndex >= 0) {
  await writeFile(
    process.argv[outIndex + 1],
    JSON.stringify({ runtime: process.versions, orders, transportMs, rounds, report }, null, 2),
  );
}
