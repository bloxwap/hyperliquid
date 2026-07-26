/**
 * End-to-end transaction execution through `ExchangeClient`, against an in-memory transport.
 *
 * Where `scenarios/signing.ts` isolates individual primitives, these scenarios measure the
 * whole path a caller actually experiences: validate -> lock -> nonce -> sign -> dispatch ->
 * validate response. They are the scenarios that catch plumbing regressions (an extra
 * `await`, a lock held too long, a redundant validation pass) that per-function benchmarks miss.
 * @module
 */

import { ExchangeClient } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { scenario } from "../_harness.ts";
import { MockExchangeTransport, TEST_PRIVATE_KEY } from "../_helpers.ts";

/** A single order, shaped exactly as it goes over the wire. */
function order(i: number): { a: number; b: boolean; p: string; s: string; r: boolean; t: { limit: { tif: "Gtc" } } } {
  return { a: i % 200, b: i % 2 === 0, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } };
}

/** Builds a client over a zero-latency transport (isolates CPU cost from network waiting). */
function instantClient(): { client: ExchangeClient; transport: MockExchangeTransport } {
  const transport = new MockExchangeTransport(0);
  const client = new ExchangeClient({ transport, wallet: privateKeyToAccount(TEST_PRIVATE_KEY) });
  return { client, transport };
}

// --- Sequential CPU cost --------------------------------------------------
// One order at a time against an instantly-resolving transport: the measured time is
// entirely SDK CPU (validation + signing + bookkeeping) with no concurrency effects.

scenario({
  name: "transaction/order_sequential",
  group: "transaction",
  description: "ExchangeClient.order() one order at a time, 0 ms transport latency (pure SDK CPU per order)",
  unit: "order",
  iterations: 50,
  samples: 10,
  setup: () => instantClient(),
  run: async ({ client }: { client: ExchangeClient }) => {
    await client.order({
      orders: [order(0)],
      grouping: "na",
    });
  },
});

scenario({
  name: "transaction/order_batch_100",
  group: "transaction",
  description: "ExchangeClient.order() with 100 orders in one action, normalized per order",
  unit: "order",
  unitsPerIteration: 100,
  iterations: 10,
  samples: 10,
  setup: () => instantClient(),
  run: async ({ client }: { client: ExchangeClient }) => {
    await client.order({
      orders: Array.from({ length: 100 }, (_, i) => order(i)),
      grouping: "na",
    });
  },
});

// --- Concurrency ---------------------------------------------------------
// 100 orders issued at once against a transport with fixed 20 ms latency.
//
// This is the scenario that exposes per-wallet lock scope. If the lock spans the network
// round trip, throughput collapses to 1 request per RTT (~50 orders/sec) and `maxInFlight`
// stays at 1. If the lock covers only nonce issuance and signing, requests overlap and
// `maxInFlight` approaches 100. `maxInFlight` is reported so the shape of the win is
// visible in the report, not just the wall time.

const LATENCY_MS = 20;
const CONCURRENT_ORDERS = 100;

scenario({
  name: "transaction/order_100_concurrent",
  group: "transaction",
  description:
    `${CONCURRENT_ORDERS} concurrent ExchangeClient.order() calls at ${LATENCY_MS} ms transport latency; ` +
    `reports peak in-flight requests`,
  unit: "order",
  unitsPerIteration: CONCURRENT_ORDERS,
  iterations: 1,
  samples: 5,
  warmupSamples: 1,
  run: async () => {
    // A fresh client per sample: the transport accumulates call history and a
    // high-water mark, both of which must not carry across samples.
    const transport = new MockExchangeTransport(LATENCY_MS);
    const client = new ExchangeClient({ transport, wallet: privateKeyToAccount(TEST_PRIVATE_KEY) });

    await Promise.all(
      Array.from({ length: CONCURRENT_ORDERS }, (_, i) => client.order({ orders: [order(i)], grouping: "na" })),
    );

    return { maxInFlight: transport.maxInFlight, calls: transport.calls.length };
  },
});
