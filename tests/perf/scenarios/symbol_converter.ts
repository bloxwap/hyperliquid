/**
 * Symbol and number plumbing every order pays before it can be built.
 *
 * A caller turning a human symbol into a request does three lookups
 * ({@linkcode SymbolConverter.getAssetId}, {@linkcode SymbolConverter.getSzDecimals},
 * {@linkcode SymbolConverter.getSpotPairId}) and two decimal formats (`formatPrice`,
 * `formatSize`). None of them touch the network, so this group is pure CPU and the least
 * noisy in the suite — which makes it the one where a small regression is still legible.
 *
 * The converter is built once in `setup` from {@linkcode MockInfoTransport} over the standard
 * fixtures, so the measured body contains lookups only, never metadata loading.
 * @module
 */

import { formatPrice, formatSize, floatToWire, SymbolConverter } from "@bloxwap/hyperliquid/utils";
import { scenario } from "../_harness.ts";
import {
  metaFixture,
  outcomeMetaFixture,
  perpName,
  PERP_COUNT,
  SPOT_COUNT,
  spotMetaFixture,
  spotTokenName,
} from "../_fixtures.ts";
import { MockInfoTransport } from "../_helpers.ts";

/** Perp symbols probed per iteration. */
const PERP_LOOKUPS = 100;
/** Spot symbols (`BASE/QUOTE`) probed per iteration. */
const SPOT_LOOKUPS = 100;

/** Outcome-market slugs the fixture's prediction markets resolve to. */
const OUTCOME_SLUGS = ["btc-above-61720-yes-jun-08-0600", "nba-finals-game-3-san-antonio-yes"] as const;

/** Spot symbols in the converter's `BASE/QUOTE` form; token 0 is the USDC quote. */
const SPOT_SYMBOLS = Array.from(
  { length: Math.min(SPOT_LOOKUPS, SPOT_COUNT - 1) },
  (_, i) => `${spotTokenName(i + 1)}/USDC`,
);

/** Perp, spot and outcome symbols interleaved — the mix a real caller looks up. */
const ALL_SYMBOLS: string[] = [
  ...Array.from({ length: Math.min(PERP_LOOKUPS, PERP_COUNT) }, (_, i) => perpName(i)),
  ...SPOT_SYMBOLS,
  ...OUTCOME_SLUGS,
];

/** Lookup context: the converter plus a sink that keeps the optimizer from eliding the calls. */
interface LookupContext {
  converter: SymbolConverter;
  sink: number;
}

/**
 * Builds the converter and asserts every probed symbol resolves.
 *
 * Without this check a fixture drift would turn the scenarios into a measurement of
 * `Map.get` misses — still fast, still green, and meaningless.
 */
async function lookupContext(): Promise<LookupContext> {
  const transport = new MockInfoTransport({
    meta: metaFixture(),
    spotMeta: spotMetaFixture(),
    outcomeMeta: outcomeMetaFixture(),
  });
  const converter = await SymbolConverter.create({ transport });

  for (const symbol of ALL_SYMBOLS) {
    if (converter.getAssetId(symbol) === undefined) {
      throw new Error(`Fixture drift: SymbolConverter has no asset id for ${JSON.stringify(symbol)}`);
    }
  }
  for (const symbol of SPOT_SYMBOLS) {
    if (converter.getSpotPairId(symbol) === undefined) {
      throw new Error(`Fixture drift: SymbolConverter has no spot pair id for ${JSON.stringify(symbol)}`);
    }
  }

  return { converter, sink: 0 };
}

// --- Lookups --------------------------------------------------------------

scenario({
  name: "utils/symbol_get_asset_id",
  group: "utils",
  description: `SymbolConverter.getAssetId() over ${ALL_SYMBOLS.length} perp, spot and outcome symbols`,
  unit: "lookup",
  unitsPerIteration: ALL_SYMBOLS.length,
  iterations: 500,
  setup: lookupContext,
  run: (ctx: LookupContext) => {
    let sum = 0;
    for (const symbol of ALL_SYMBOLS) sum += ctx.converter.getAssetId(symbol) ?? 0;
    ctx.sink += sum;
  },
});

scenario({
  name: "utils/symbol_get_sz_decimals",
  group: "utils",
  description: `SymbolConverter.getSzDecimals() over ${ALL_SYMBOLS.length} perp, spot and outcome symbols`,
  unit: "lookup",
  unitsPerIteration: ALL_SYMBOLS.length,
  iterations: 500,
  setup: lookupContext,
  run: (ctx: LookupContext) => {
    let sum = 0;
    for (const symbol of ALL_SYMBOLS) sum += ctx.converter.getSzDecimals(symbol) ?? 0;
    ctx.sink += sum;
  },
});

scenario({
  name: "utils/symbol_get_spot_pair_id",
  group: "utils",
  description: `SymbolConverter.getSpotPairId() over ${SPOT_SYMBOLS.length} spot symbols`,
  unit: "lookup",
  unitsPerIteration: SPOT_SYMBOLS.length,
  iterations: 500,
  setup: lookupContext,
  run: (ctx: LookupContext) => {
    let sum = 0;
    for (const symbol of SPOT_SYMBOLS) sum += ctx.converter.getSpotPairId(symbol)?.length ?? 0;
    ctx.sink += sum;
  },
});

// --- Decimal formatting ---------------------------------------------------
// `formatPrice` and `formatSize` parse and truncate decimals as strings on every call,
// so they are far costlier than a symbol lookup and are the realistic candidate for a
// fast path on the order-building route.

/** Price inputs spanning magnitudes and `szDecimals`, none of which truncate to zero. */
const PRICE_INPUTS: readonly [price: string, szDecimals: number][] = Array.from(
  { length: 100 },
  (_, i) => [`${97000 + i}.${(123456789 + i) % 1_000_000_000}`, i % 6] as [string, number],
);

/** Size inputs kept at or above 1 so no value truncates to zero at `szDecimals` 0. */
const SIZE_INPUTS: readonly [size: string, szDecimals: number][] = Array.from(
  { length: 100 },
  (_, i) => [`${1 + i}.${(23456789 + i) % 100_000_000}`, i % 6] as [string, number],
);

scenario({
  name: "utils/format_price",
  group: "utils",
  description: `formatPrice() over ${PRICE_INPUTS.length} values spanning szDecimals 0-5`,
  unit: "value",
  unitsPerIteration: PRICE_INPUTS.length,
  // ~350 ns per call: a sample needs thousands of iterations to rise above timer
  // granularity and scheduler jitter, or the reported spread is all noise.
  iterations: 5000,
  samples: 15,
  setup: () => ({ sink: 0 }),
  run: (ctx: { sink: number }) => {
    let total = 0;
    for (const [price, szDecimals] of PRICE_INPUTS) total += formatPrice(price, szDecimals).length;
    ctx.sink += total;
  },
});

scenario({
  name: "utils/format_size",
  group: "utils",
  description: `formatSize() over ${SIZE_INPUTS.length} values spanning szDecimals 0-5`,
  unit: "value",
  unitsPerIteration: SIZE_INPUTS.length,
  // ~350 ns per call: a sample needs thousands of iterations to rise above timer
  // granularity and scheduler jitter, or the reported spread is all noise.
  iterations: 5000,
  samples: 15,
  setup: () => ({ sink: 0 }),
  run: (ctx: { sink: number }) => {
    let total = 0;
    for (const [size, szDecimals] of SIZE_INPUTS) total += formatSize(size, szDecimals).length;
    ctx.sink += total;
  },
});

// --- Wire float conversion -------------------------------------------------
// `floatToWire` runs a native-`toFixed` fast path for ordinary values and pays an exact BigInt
// expansion only for ties and |x| >= 1e21; this scenario guards the fast path (~170 ns) against
// silently falling back to the expansion on every call (~570 ns).

/** 8-decimal-clean floats spanning 1e-8..1e6 — the prices and sizes that actually reach the wire. */
const WIRE_INPUTS: readonly number[] = Array.from({ length: 100 }, (_, i) => {
  const magnitude = 10 ** ((i % 15) - 8);
  return Number(((1 + (i % 97) / 97) * magnitude).toFixed(8));
});

scenario({
  name: "utils/float_to_wire",
  group: "utils",
  description: `floatToWire() over ${WIRE_INPUTS.length} wire-clean values spanning 1e-8..1e6`,
  unit: "value",
  unitsPerIteration: WIRE_INPUTS.length,
  iterations: 5000,
  samples: 15,
  setup: () => ({ sink: 0 }),
  run: (ctx: { sink: number }) => {
    let total = 0;
    for (const value of WIRE_INPUTS) total += floatToWire(value).length;
    ctx.sink += total;
  },
});
