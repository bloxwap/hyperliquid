/**
 * Inbound Info-response cost: what a caller pays per `InfoClient` read.
 *
 * Every scenario drives a real {@linkcode InfoClient} over {@linkcode MockInfoTransport},
 * which answers from a fixed, realistically sized payload (see `tests/perf/_fixtures.ts`).
 * No network, no clock skew, no server variance — two runs differ only if the SDK did.
 *
 * ## What the numbers include
 *
 * One call costs: valibot validation of the request against its schema, the client's
 * dispatch plumbing, and `JSON.parse` of the response body. Response types in this SDK
 * are type-only — there is no runtime schema pass on the way in — so the inbound half of
 * the cost is the JSON decode, which is why the payload sizes here match mainnet.
 *
 * Results are normalized per *element* (book level, mid, position, asset) rather than per
 * call, so a regression in per-element cost is visible instead of being averaged into one
 * large per-call number.
 * @module
 */

import { InfoClient } from "@bloxwap/hyperliquid";
import { scenario } from "../_harness.ts";
import {
  allMidsFixture,
  BOOK_LEVELS_PER_SIDE,
  clearinghouseStateFixture,
  FIXTURE_USER,
  l2BookFixture,
  metaAndAssetCtxsFixture,
  MIDS_COUNT,
  PERP_COUNT,
  POSITION_COUNT,
} from "../_fixtures.ts";
import { MockInfoTransport } from "../_helpers.ts";

/** Builds an {@linkcode InfoClient} whose transport serves exactly the given payloads. */
function infoClient(payloads: Record<string, unknown>): { client: InfoClient } {
  return { client: new InfoClient({ transport: new MockInfoTransport(payloads) }) };
}

// --- Order book -----------------------------------------------------------
// The hottest read in any trading loop: a full-depth book snapshot, normalized per level.

scenario({
  name: "data/parse_l2_book",
  group: "data",
  description: `InfoClient.l2Book() over a ${BOOK_LEVELS_PER_SIDE}-level-per-side snapshot, per book level`,
  unit: "level",
  unitsPerIteration: BOOK_LEVELS_PER_SIDE * 2,
  iterations: 200,
  setup: () => infoClient({ l2Book: l2BookFixture("BTC") }),
  run: async ({ client }: { client: InfoClient }) => {
    await client.l2Book({ coin: "BTC" });
  },
});

// --- Mids -----------------------------------------------------------------
// A flat map of string values: the cheapest possible payload per element, so this scenario
// is the suite's floor for per-element inbound cost.

scenario({
  name: "data/parse_all_mids",
  group: "data",
  description: `InfoClient.allMids() over ${MIDS_COUNT} coins, per mid`,
  unit: "mid",
  unitsPerIteration: MIDS_COUNT,
  iterations: 100,
  setup: () => infoClient({ allMids: allMidsFixture() }),
  run: async ({ client }: { client: InfoClient }) => {
    await client.allMids();
  },
});

// --- User state -----------------------------------------------------------
// Deeply nested objects (leverage union, cumulative funding) rather than flat strings, and
// the request carries an `Address` refinement — the most validation-heavy request here.

scenario({
  name: "data/parse_clearinghouse_state",
  group: "data",
  description: `InfoClient.clearinghouseState() over ${POSITION_COUNT} open positions, per position`,
  unit: "position",
  unitsPerIteration: POSITION_COUNT,
  iterations: 100,
  setup: () => infoClient({ clearinghouseState: clearinghouseStateFixture() }),
  run: async ({ client }: { client: InfoClient }) => {
    await client.clearinghouseState({ user: FIXTURE_USER });
  },
});

// --- Metadata + contexts --------------------------------------------------
// The largest payload the API serves routinely: full perp metadata plus a context per
// asset, fetched at startup and on every metadata refresh.

scenario({
  name: "data/parse_meta_and_asset_ctxs",
  group: "data",
  description: `InfoClient.metaAndAssetCtxs() over ${PERP_COUNT} assets (meta + context), per asset`,
  unit: "asset",
  unitsPerIteration: PERP_COUNT,
  iterations: 50,
  setup: () => infoClient({ metaAndAssetCtxs: metaAndAssetCtxsFixture() }),
  run: async ({ client }: { client: InfoClient }) => {
    await client.metaAndAssetCtxs();
  },
});
