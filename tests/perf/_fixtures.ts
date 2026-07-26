/**
 * Deterministic Info-endpoint payload fixtures for the performance suite.
 *
 * Every builder returns data shaped exactly like the real endpoint and sized like a
 * real mainnet response (~200 perps, ~150 spot tokens, 20 book levels per side), because
 * the numbers these scenarios report are only meaningful at realistic payload sizes.
 *
 * The builders are pure and seeded off the element index alone: two runs produce
 * byte-identical payloads, so a report difference is a code difference.
 *
 * Types come from the SDK's own response types, so a schema change breaks the fixture
 * at type-check time instead of silently measuring a payload the API no longer sends.
 * @module
 */

import type {
  AllMidsResponse,
  ClearinghouseStateResponse,
  L2BookResponse,
  MetaAndAssetCtxsResponse,
  MetaResponse,
  OutcomeMetaResponse,
  SpotMetaResponse,
} from "@bloxwap/hyperliquid/api/info";

/** Perpetual assets in the fixture universe, close to the live mainnet count. */
export const PERP_COUNT = 200;
/** Spot tokens (and therefore spot pairs) in the fixture universe. */
export const SPOT_COUNT = 150;
/** Book levels per side, the maximum the `l2Book` endpoint returns. */
export const BOOK_LEVELS_PER_SIDE = 20;
/** Coins in the `allMids` fixture (perps plus spot pairs). */
export const MIDS_COUNT = 350;
/** Open positions in the `clearinghouseState` fixture — a busy but plausible account. */
export const POSITION_COUNT = 20;

/** A well-known address; valid for the `Address` schema every user-scoped request validates. */
export const FIXTURE_USER = "0x0000000000000000000000000000000000000001" as const;

/** Formats `value` with `decimals` decimal places, matching the API's string-encoded numbers. */
function num(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

/** Perpetual coin name for index `i` (`BTC` and `ETH` first so fixtures read like real data). */
export function perpName(i: number): string {
  return i === 0 ? "BTC" : i === 1 ? "ETH" : `PERP${i}`;
}

/** Spot token name for index `i` (index 0 is the USDC quote token, as on mainnet). */
export function spotTokenName(i: number): string {
  return i === 0 ? "USDC" : i === 1 ? "PURR" : `TOK${i}`;
}

// --- Metadata --------------------------------------------------------------

/** `meta` response with {@linkcode PERP_COUNT} assets and two margin tables. */
export function metaFixture(): MetaResponse {
  return {
    universe: Array.from({ length: PERP_COUNT }, (_, i) => ({
      szDecimals: i % 6,
      name: perpName(i),
      maxLeverage: 3 + (i % 8) * 5,
      marginTableId: i % 2 === 0 ? 50 : 51,
      ...(i % 25 === 24 ? { isDelisted: true as const } : {}),
    })),
    marginTables: [
      [
        50,
        {
          description: "tiered margin, 40x",
          marginTiers: [
            { lowerBound: "0.0", maxLeverage: 40 },
            { lowerBound: "3000000.0", maxLeverage: 20 },
          ],
        },
      ],
      [
        51,
        {
          description: "tiered margin, 20x",
          marginTiers: [
            { lowerBound: "0.0", maxLeverage: 20 },
            { lowerBound: "1000000.0", maxLeverage: 10 },
          ],
        },
      ],
    ],
    collateralToken: 0,
  };
}

/** `spotMeta` response with {@linkcode SPOT_COUNT} tokens, each paired against USDC. */
export function spotMetaFixture(): SpotMetaResponse {
  return {
    // Token 0 is the quote asset, so pairs start at token index 1.
    universe: Array.from({ length: SPOT_COUNT - 1 }, (_, i) => ({
      tokens: [i + 1, 0] as [number, number],
      // Only a handful of pairs keep a human name on mainnet; the rest are `@<index>`.
      name: i === 0 ? "PURR/USDC" : `@${i}`,
      index: i,
      isCanonical: i < 2,
    })),
    tokens: Array.from({ length: SPOT_COUNT }, (_, i) => ({
      name: spotTokenName(i),
      szDecimals: i % 4,
      weiDecimals: 6 + (i % 3),
      index: i,
      tokenId: `0x${i.toString(16).padStart(32, "0")}` as `0x${string}`,
      isCanonical: i < 2,
      evmContract:
        i % 10 === 0
          ? { address: `0x${i.toString(16).padStart(40, "0")}` as `0x${string}`, evm_extra_wei_decimals: 2 }
          : null,
      fullName: i % 3 === 0 ? `${spotTokenName(i)} Token` : null,
      deployerTradingFeeShare: "0.5",
    })),
  };
}

/**
 * `outcomeMeta` response with two prediction-market questions.
 *
 * `SymbolConverter` always fetches this endpoint, and its slug builder covers
 * three shapes (recurring binary, recurring bucket, plain named outcome) — all three are
 * present so the converter's build cost is not understated.
 */
export function outcomeMetaFixture(): OutcomeMetaResponse {
  return {
    outcomes: [
      {
        outcome: 220,
        name: "BTC above 61720",
        description: "class:priceBinary|underlying:BTC|expiry:20260608-0600|targetPrice:61720",
        sideSpecs: [
          { name: "Yes", token: 400 },
          { name: "No", token: 401 },
        ],
        quoteToken: "USDC",
      },
      {
        outcome: 221,
        name: "San Antonio",
        description: "NBA finals game 3 winner",
        sideSpecs: [
          { name: "Yes", token: 402 },
          { name: "No", token: 403 },
        ],
        quoteToken: "USDC",
      },
      // Fallback outcome: not tradable, and the converter must skip it.
      {
        outcome: 222,
        name: "Neither",
        description: "fallback",
        sideSpecs: [{ name: "Yes", token: 404 }],
        quoteToken: "USDC",
      },
    ],
    questions: [
      {
        question: 30,
        name: "BTC price",
        description: "class:priceBucket|underlying:BTC|expiry:20260608-0600|priceThresholds:60000,70000",
        fallbackOutcome: 222,
        namedOutcomes: [220],
        settledNamedOutcomes: [],
      },
      {
        question: 31,
        name: "NBA finals game 3",
        description: "Winner of game 3",
        fallbackOutcome: 222,
        namedOutcomes: [221],
        settledNamedOutcomes: [],
      },
    ],
  };
}

// --- Market data -----------------------------------------------------------

/** `l2Book` response with {@linkcode BOOK_LEVELS_PER_SIDE} levels on each side. */
export function l2BookFixture(coin = "BTC"): L2BookResponse {
  const side = (sign: 1 | -1): { px: string; sz: string; n: number }[] =>
    Array.from({ length: BOOK_LEVELS_PER_SIDE }, (_, i) => ({
      px: num(97000 + sign * (i + 1) * 0.5),
      sz: num(0.05 + i * 0.013, 5),
      n: 1 + (i % 7),
    }));
  return { coin, time: 1_700_000_000_000, levels: [side(-1), side(1)] };
}

/** `allMids` response with {@linkcode MIDS_COUNT} coins. */
export function allMidsFixture(): AllMidsResponse {
  const mids: Record<string, string> = {};
  for (let i = 0; i < MIDS_COUNT; i++) {
    // Past the perp universe the API keys mids by spot pair id (`@<index>`).
    const coin = i < PERP_COUNT ? perpName(i) : `@${i - PERP_COUNT}`;
    mids[coin] = num(10 + i * 1.37, 4);
  }
  return mids;
}

/** `clearinghouseState` response with {@linkcode POSITION_COUNT} open positions. */
export function clearinghouseStateFixture(): ClearinghouseStateResponse {
  const summary = {
    accountValue: "1250000.5",
    totalNtlPos: "3400000.25",
    totalRawUsd: "-2150000.75",
    totalMarginUsed: "170000.125",
  };
  return {
    marginSummary: { ...summary },
    crossMarginSummary: { ...summary },
    crossMaintenanceMarginUsed: "42500.5",
    withdrawable: "1080000.375",
    assetPositions: Array.from({ length: POSITION_COUNT }, (_, i) => ({
      type: "oneWay" as const,
      position: {
        coin: perpName(i),
        szi: num((i % 2 === 0 ? 1 : -1) * (0.5 + i * 0.25), 4),
        // Alternate leverage kinds so both branches of the union are represented.
        leverage:
          i % 3 === 0
            ? { type: "isolated" as const, value: 10, rawUsd: num(-12500 - i * 100) }
            : { type: "cross" as const, value: 20 },
        entryPx: num(96000 + i * 13.5),
        positionValue: num(48000 + i * 250),
        unrealizedPnl: num((i % 2 === 0 ? 1 : -1) * (125 + i * 7.5)),
        returnOnEquity: num((i % 2 === 0 ? 1 : -1) * 0.0125, 6),
        liquidationPx: i % 5 === 0 ? null : num(72000 + i * 11),
        marginUsed: num(2400 + i * 12.5),
        maxLeverage: 3 + (i % 8) * 5,
        cumFunding: {
          allTime: num(-1250.5 + i, 4),
          sinceOpen: num(-42.25 + i, 4),
          sinceChange: num(-12.125 + i, 4),
        },
      },
    })),
    time: 1_700_000_000_000,
  };
}

/** `metaAndAssetCtxs` response: the {@linkcode metaFixture} metadata plus one context per asset. */
export function metaAndAssetCtxsFixture(): MetaAndAssetCtxsResponse {
  const meta = metaFixture();
  const ctxs: MetaAndAssetCtxsResponse[1] = Array.from({ length: PERP_COUNT }, (_, i) => ({
    prevDayPx: num(96000 + i * 3.5),
    dayNtlVlm: num(125_000_000 + i * 1000, 4),
    markPx: num(97000 + i * 3.5),
    midPx: i % 17 === 16 ? null : num(97000.5 + i * 3.5),
    funding: num((i % 2 === 0 ? 1 : -1) * 0.0000125, 8),
    openInterest: num(4200 + i, 4),
    premium: i % 19 === 18 ? null : num((i % 2 === 0 ? 1 : -1) * 0.00025, 6),
    oraclePx: num(96999 + i * 3.5),
    impactPxs: i % 23 === 22 ? null : [num(96998 + i * 3.5), num(97002 + i * 3.5)],
    dayBaseVlm: num(1287.5 + i, 4),
  }));
  return [meta, ctxs];
}
