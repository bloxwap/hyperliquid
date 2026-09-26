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
import { createNonceManager, type NonceManager } from "../../../src/api/exchange/_methods/_base/_nonce.ts";
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
//
// ┌─ READ THIS BEFORE COMPARING THE NUMBER TO `order_sequential` ─────────────────────────┐
// │ This scenario runs at LATENCY_MS = 20 while `order_sequential` runs at 0, and the      │
// │ harness divides the whole burst's wall time by CONCURRENT_ORDERS. One round trip       │
// │ cannot be amortized below itself, so 20 ms / 100 = **200 µs of pure waiting is         │
// │ charged to every order** before any SDK cost is counted.                               │
// │                                                                                        │
// │ Wall time is `RTT + N x C`, where C is the serialized per-order CPU (secp256k1 is      │
// │ single-threaded, so the N signatures queue). At N=100 that predicts                    │
// │ 20 ms + 100 x ~110 µs = ~31 ms, i.e. ~310 µs/order — which is what the suite reports.  │
// │ The gap to `order_sequential` is arithmetic, NOT lock or queue contention: with        │
// │ LATENCY_MS flipped to 0 the same scenario measures ~142 µs/order against               │
// │ `order_sequential`'s ~157 µs, so concurrency is measurably CHEAPER per order.          │
// │                                                                                        │
// │ Four separate audits have "discovered" a phantom 200 µs regression here. Compare       │
// │ against `order_100_concurrent_instant` below, which is the apples-to-apples number,    │
// │ and read this one for `maxInFlight` — the overlap guard it was written to be.          │
// └────────────────────────────────────────────────────────────────────────────────────────┘

const LATENCY_MS = 20;
const CONCURRENT_ORDERS = 100;

scenario({
  name: "transaction/order_100_concurrent",
  group: "transaction",
  description:
    `${CONCURRENT_ORDERS} concurrent ExchangeClient.order() calls at ${LATENCY_MS} ms transport latency; ` +
    `reports peak in-flight requests. ${(LATENCY_MS * 1000) / CONCURRENT_ORDERS} µs/order of the figure is ` +
    `amortized RTT — see order_100_concurrent_instant for SDK CPU`,
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

    // `latencyMs` and `rttPerOrderUs` are reported so the report itself carries the arithmetic
    // above — a reader who never opens this file still sees how much of the figure is waiting.
    return {
      maxInFlight: transport.maxInFlight,
      calls: transport.calls.length,
      latencyMs: LATENCY_MS,
      rttPerOrderUs: Math.round((LATENCY_MS * 1000) / CONCURRENT_ORDERS),
    };
  },
});

// The apples-to-apples counterpart: identical shape, zero transport latency, so the figure is
// the SDK's own per-order CPU under 100-way concurrency and is directly comparable to
// `order_sequential`. Added alongside the 20 ms scenario rather than replacing it — the perf
// gate joins baselines by scenario name, so renaming or re-parameterizing the existing one
// would silently invalidate every recorded baseline.
//
// `maxInFlight` is 1 here, and that is correct rather than a lock regression: a zero-latency
// transport resolves on a microtask, so each order settles before the next one's signature
// finishes. The 100 calls are still genuinely concurrent through validate → lock → nonce →
// sign, which is the part this scenario measures; overlap ON THE WIRE is what the 20 ms
// sibling exists to assert, and only its `maxInFlight` carries that meaning.
scenario({
  name: "transaction/order_100_concurrent_instant",
  group: "transaction",
  description:
    `${CONCURRENT_ORDERS} concurrent ExchangeClient.order() calls at 0 ms transport latency ` +
    `(SDK CPU per order under concurrency; compare directly against order_sequential)`,
  unit: "order",
  unitsPerIteration: CONCURRENT_ORDERS,
  iterations: 1,
  samples: 5,
  warmupSamples: 1,
  run: async () => {
    const transport = new MockExchangeTransport(0);
    const client = new ExchangeClient({ transport, wallet: privateKeyToAccount(TEST_PRIVATE_KEY) });

    await Promise.all(
      Array.from({ length: CONCURRENT_ORDERS }, (_, i) => client.order({ orders: [order(i)], grouping: "na" })),
    );

    return { maxInFlight: transport.maxInFlight, calls: transport.calls.length };
  },
});

// --- Nonce manager over capacity ------------------------------------------
// gh issue #7: with more than `maxEntries` (10k) active wallet keys and nonces running
// ahead of wall clock, a prune scan can never free anything — so the old per-call scan
// was a sustained O(n) sweep on every nonce issued. The fix throttles the scan to one
// pass per second; this scenario keeps the manager permanently in that regime so the
// per-call cost of the over-capacity path is what gets measured.

const OVER_CAPACITY_KEYS = 12_000;

/** Formats an index as a wallet-like key, matching how callers key the nonce manager. */
function walletKey(i: number): string {
  return `0x${i.toString(16).padStart(40, "0")}`;
}

scenario({
  name: "transaction/nonce_manager_over_capacity",
  group: "transaction",
  description:
    `getNonce() over ${OVER_CAPACITY_KEYS} distinct wallet keys (above the 10k prune threshold) with the clock ` +
    "frozen, so every nonce runs ahead of wall time and prune scans can free nothing",
  unit: "nonce",
  iterations: 500,
  samples: 10,
  setup: () => {
    // Freeze the clock for the whole scenario (restored in teardown): each key's nonce is
    // then always `last + 1`, ahead of wall time — the worst case for pruning. The harness
    // times with `performance.now()`, which is untouched.
    const realDateNow = Date.now;
    const frozen = realDateNow();
    Date.now = () => frozen;
    // Keys are built up front so the measured body is nonce issuance only, not string
    // formatting — otherwise a constant ~100 ns of `toString`/`padStart` per call would
    // dilute the very cost this scenario exists to track.
    const keys = Array.from({ length: OVER_CAPACITY_KEYS }, (_, i) => walletKey(i));
    const manager = createNonceManager();
    for (const key of keys) manager.getNonce(key);
    return {
      manager,
      keys,
      next: 0,
      restore: (): void => {
        Date.now = realDateNow;
      },
    };
  },
  teardown: ({ restore }: { restore: () => void }) => {
    restore();
  },
  run: (ctx: { manager: NonceManager; keys: readonly string[]; next: number }) => {
    ctx.manager.getNonce(ctx.keys[ctx.next++ % OVER_CAPACITY_KEYS]);
  },
});

// --- Skip-validation fast path (issue #28) ----------------------------------
// `skipValidation: true` opts out of the valibot parse + canonicalize pass. secp256k1 dominates
// the sequential call (~150 µs of ~156 µs), so the saving is below the noise floor here — the
// isolated view is `signing/order_e2e_no_ecdsa_unchecked`. This scenario exists so the report
// shows the unchecked path end to end and guards its plumbing against regressions.

scenario({
  name: "transaction/order_sequential_unchecked",
  group: "transaction",
  description:
    "ExchangeClient.order() with skipValidation: true, one order at a time, 0 ms transport latency (opt-in fast path)",
  unit: "order",
  iterations: 50,
  samples: 10,
  setup: () => instantClient(),
  run: async ({ client }: { client: ExchangeClient }) => {
    await client.order({ orders: [order(0)], grouping: "na" }, { skipValidation: true });
  },
});

// --- prepareRequest capture cost ---------------------------------------------
// prepareRequest (issue #22) runs a full exchange call against a capture transport. It must
// stay in the µs range: a `setTimeout(0)` drain once regressed a minimal prepare to ~1.2 ms
// (macrotask clamping) for a contract window the poison mechanism already covers. Stub wallet
// (same shape as `digestStubWallet` in scenarios/signing.ts) keeps secp256k1 off the clock so
// the scenario measures exactly the capture path. (The import declaration is hoisted; keeping
// it next to the scenario keeps this file append-only.)

import { order as orderFn } from "@bloxwap/hyperliquid/api/exchange";

/** A viem-local-shaped wallet whose `sign`/`signTypedData` return a fixed signature without touching the curve. */
function digestStubWallet(address: `0x${string}`): {
  address: `0x${string}`;
  sign: (args: { hash: `0x${string}` }) => Promise<`0x${string}`>;
  signTypedData: (params: unknown) => Promise<`0x${string}`>;
} {
  const signature = `0x${"11".repeat(64)}1b` as `0x${string}`;
  return {
    address,
    sign: (_args: { hash: `0x${string}` }) => Promise.resolve(signature),
    signTypedData: (_params: unknown) => Promise.resolve(signature),
  };
}

scenario({
  name: "transaction/prepare_request",
  group: "transaction",
  description: "ExchangeClient.prepareRequest() of a 1-order action with a stub wallet (capture path, nothing posted)",
  unit: "prepare",
  iterations: 200,
  samples: 15,
  setup: () => {
    const transport = new MockExchangeTransport(0);
    const client = new ExchangeClient({
      transport,
      wallet: digestStubWallet("0x1111111111111111111111111111111111111111"),
    });
    return { client };
  },
  run: async ({ client }: { client: ExchangeClient }) => {
    await client.prepareRequest((c) => orderFn(c, { orders: [order(0)], grouping: "na" }));
  },
});
