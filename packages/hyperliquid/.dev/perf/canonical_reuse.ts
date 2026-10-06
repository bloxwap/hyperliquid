/**
 * Paired offline comparison of fresh versus reused canonical actions.
 * <bun|node> .dev/perf/canonical_reuse.ts [--filter real_viem] [--out /tmp/canonical-reuse.json]
 *
 * Each group times one complete exchange call per iteration. The `memory` wire returns a fixed response
 * without serializing; the `http` wire is the real `HttpTransport` over a mocked `fetch`, so the SDK's
 * wire serialization stays in the measurement. Variants:
 * - `direct`: the existing raw `order` function (validate → sign → submit).
 * - `fresh`: `buildOrder` on every call, then `executeAction`.
 * - `reused`: one `buildOrder` reused by `executeAction`.
 * - `staged`: one `buildOrder` reused by `signAction` then `submitAction`.
 *
 * Wallets: `stub` returns a constant signature (isolates SDK overhead), `real_viem` is viem's local
 * account and `real_fast` is the SDK's WASM-accelerated local wallet. Cases rotate inside every
 * round so machine drift hits each one equally. Numbers are CPU time with mocks, not network latency.
 * @module
 */
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import type { ExchangeConfig } from "../../src/api/exchange/_methods/_base/_config.ts";
import { buildOrder, order, type OrderParameters } from "../../src/api/exchange/_methods/order.ts";
import { executeAction, signAction, submitAction } from "../../src/actions/execution.ts";
import { createFastLocalWallet } from "../../src/signing/mod.ts";
import { HttpTransport } from "../../src/transport/http/mod.ts";
import type { AbstractViemLocalAccount } from "../../src/signing/mod.ts";

const filterIndex = process.argv.indexOf("--filter");
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : undefined;
const outIndex = process.argv.indexOf("--out");
const sampleCount = 11;
const privateKey = `0x${"11".repeat(32)}` as const;
const signature = `0x${"11".repeat(64)}1b` as const;
const input = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };

let sink = 0;
const wallets: Record<string, () => Promise<AbstractViemLocalAccount>> = {
  stub: async () => ({ address: privateKeyToAccount(privateKey).address, signTypedData: async () => signature }),
  real_viem: async () => privateKeyToAccount(privateKey),
  real_fast: () => createFastLocalWallet(privateKey),
};

function config(wallet: AbstractViemLocalAccount, wire: string, count: number): ExchangeConfig {
  let nonce = 1_700_000_000_000;
  const statuses = Array.from({ length: count }, (_, i) => ({ resting: { oid: i + 1 } }));
  const response = { status: "ok", response: { type: "order", data: { statuses } } };
  if (wire === "http") {
    const body = JSON.stringify(response);
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      sink ^= (init.body as string).length;
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  }
  return {
    wallet,
    nonceManager: () => ++nonce,
    transport:
      wire === "http"
        ? new HttpTransport({ isTestnet: true, timeout: null })
        : {
            isTestnet: true,
            request: async <T>(): Promise<T> => response as T,
          },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const originalFetch = globalThis.fetch;
const results: { scenario: string; variant: string; medianUs: number; vsDirect: number; roundsUs: number[] }[] = [];
for (const [walletName, createWallet] of Object.entries(wallets))
  for (const wire of ["memory", "http"])
    for (const count of [1, 100]) {
      const scenario = `canonical_${walletName}_${wire}_${count}`;
      if (filter !== undefined && !scenario.includes(filter)) continue;
      const params: OrderParameters = { orders: Array.from({ length: count }, () => input), grouping: "na" };
      const exchange = config(await createWallet(), wire, count);
      const reused = buildOrder(params);
      const cases: Record<string, () => Promise<unknown>> = {
        direct: () => order(exchange, params),
        fresh: () => executeAction(exchange, buildOrder(params)),
        reused: () => executeAction(exchange, reused),
        staged: async () => submitAction(exchange, await signAction(exchange, reused)),
      };
      const entries = Object.entries(cases);
      const rounds = entries.map(() => [] as number[]);
      const iterations = Math.max(20, Math.floor((walletName === "stub" ? 4000 : 400) / Math.sqrt(count)));
      // Three discarded warmup rounds, then rotate the starting case each round.
      for (let round = -3; round < sampleCount; round++) {
        for (let index = 0; index < entries.length; index++) {
          const selected = (index + round + entries.length * 3) % entries.length;
          const start = performance.now();
          for (let i = 0; i < iterations; i++) await entries[selected][1]();
          if (round >= 0) rounds[selected].push(((performance.now() - start) * 1000) / iterations);
        }
      }
      const direct = median(rounds[0]);
      entries.forEach(([variant], i) => {
        const medianUs = median(rounds[i]);
        results.push({ scenario, variant, medianUs, vsDirect: medianUs / direct, roundsUs: rounds[i] });
      });
    }
globalThis.fetch = originalFetch;

console.table(
  results.map(({ scenario, variant, medianUs, vsDirect }) => ({
    scenario,
    variant,
    medianUs: Number(medianUs.toFixed(2)),
    vsDirect: Number(vsDirect.toFixed(3)),
  })),
);
if (outIndex >= 0) {
  const runtime = typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;
  const meta = { runtime, cpu: cpus()[0]?.model, sampleCount, sink };
  await writeFile(process.argv[outIndex + 1], `${JSON.stringify({ meta, results }, null, 2)}\n`);
}
