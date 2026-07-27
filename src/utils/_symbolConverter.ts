import {
  meta,
  type MetaResponse,
  outcomeMeta,
  type OutcomeMetaResponse,
  perpDexs,
  type PerpDexsResponse,
  spotMeta,
  type SpotMetaResponse,
} from "../api/info/mod.ts";
import type { IRequestTransport } from "../transport/mod.ts";
import { type DecimalParts, FormatError, stripTrailingZeros, toDecimal, toFixed } from "./_decimal.ts";

/**
 * Parse a string or number into finite, strictly positive decimal parts.
 *
 * @throws {FormatError} If the value is unparsable, not finite, or not greater than 0.
 */
function toPriceDecimal(value: string | number): DecimalParts {
  const parts = toDecimal(value, "price");
  // A tick grid is only defined for positive prices (formatPrice allows negatives, but
  // "buy"/"sell" rounding direction is meaningless at or below zero).
  if (parts.sign < 0 || parts.digits === "") {
    throw new FormatError(`Invalid price: ${String(value)} must be greater than 0`);
  }
  return parts;
}

/**
 * Base-10 exponent of the tick size at price level `d`, combining the
 * {@link https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size | tick rules}
 * exactly as `formatPrice` enforces them:
 * - 5 significant figures → with the most significant digit at `10^(d.exp - 1)`, the last
 *   significant digit sits at `10^(d.exp - 5)`;
 * - at most `maxDecimals` decimal places → the tick cannot be finer than `10^(-maxDecimals)`;
 * - integer prices are exempt from the significant-figure cap, so the tick never exceeds `10^0`
 *   (above 99999 every integer is valid, whatever the significant-figure count).
 */
function tickExponent(d: DecimalParts, maxDecimals: number): number {
  return Math.min(Math.max(d.exp - 5, -maxDecimals), 0);
}

/** Increment a string of ASCII digits by one; the result may grow a digit ("999" → "1000"). */
function incrementDigits(digits: string): string {
  const chars = digits.split("");
  let i = chars.length;
  while (i-- > 0) {
    if (chars[i] === "9") {
      chars[i] = "0";
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join("");
    }
  }
  return `1${chars.join("")}`;
}

/**
 * Round a positive decimal to the `10^tickExp` grid: toward zero when `roundUp` is false,
 * away from zero when true. Since the grid unit is a power of ten, "divide by the tick, round,
 * multiply back" reduces to truncating the digit string at a position — plus a string increment
 * for the upward case — with no arbitrary-precision division and no floats.
 *
 * Digit `i` of the normalized form has place value `10^(d.exp - 1 - i)`, so the digits at
 * indices below `keep = d.exp - tickExp` are exactly the ones at or above the grid unit.
 */
function roundToTick(d: DecimalParts, tickExp: number, roundUp: boolean): DecimalParts {
  const keep = d.exp - tickExp;

  // Already an exact multiple of the tick: rounding is the identity.
  if (keep >= d.digits.length) return d;

  // Every significant digit is finer than the tick: down collapses to zero, up lands on one tick.
  if (keep <= 0) {
    return roundUp ? { sign: d.sign, digits: "1", exp: tickExp + 1 } : { sign: d.sign, digits: "", exp: 0 };
  }

  if (!roundUp) {
    return { sign: d.sign, digits: stripTrailingZeros(d.digits.slice(0, keep)), exp: d.exp };
  }

  const bumped = incrementDigits(d.digits.slice(0, keep));
  if (bumped.length > keep) {
    // The increment carried past the most significant digit: the result is the next power of ten.
    return { sign: d.sign, digits: "1", exp: d.exp + 1 };
  }
  return { sign: d.sign, digits: stripTrailingZeros(bumped), exp: d.exp };
}

/** Options for {@link SymbolConverter.roundPrice}. */
export interface RoundPriceOptions {
  /**
   * Rounding mode: `false` (default) rounds the conservative maker way — a buy down, a sell up, so the
   * rounded price is never more aggressive than requested. `true` flips both directions for taker-style
   * orders where fill probability matters more than the half-tick given up.
   */
  aggressive?: boolean;
}

/**
 * Mutable snapshot of the lookup maps, built privately by {@link SymbolConverter._reload}
 * and published onto the instance in a single synchronous block once fully populated.
 */
interface SymbolConverterDraft {
  nameToAssetId: Map<string, number>;
  nameToSzDecimals: Map<string, number>;
  nameToSpotPairId: Map<string, string>;
  spotPairIdToName: Map<string, string>;
  /** Slugs of outcome markets, which follow the spot (not perp) price rules. */
  outcomeNames: Set<string>;
}

/** Options for creating a {@link SymbolConverter} instance. */
export interface SymbolConverterOptions {
  /** Transport instance to use for API requests. */
  transport: IRequestTransport;
  /** Optional dex support: array of dex names, true for all dexs, or false/undefined to skip. */
  dexs?: string[] | boolean;
}

/**
 * Utility class for converting asset symbols to their corresponding IDs and size decimals.
 * Supports perpetuals, spots, optional builder dexs and outcome markets.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 * const converter = await SymbolConverter.create({ transport });
 *
 * // By default, dexs are not loaded; specify them when creating an instance
 * // const converter = await SymbolConverter.create({ transport, dexs: ["test"] });
 *
 * const btcId = converter.getAssetId("BTC"); // perpetual → 0
 * const hypeUsdcId = converter.getAssetId("HYPE/USDC"); // spot → 10107
 * const dexAbcId = converter.getAssetId("test:ABC"); // builder dex (if enabled) → 110000
 * const outcomeId = converter.getAssetId("btc-above-61720-yes-jun-08-0600"); // outcome market → 100002200
 *
 * const btcSzDecimals = converter.getSzDecimals("BTC"); // perpetual → 5
 * const hypeUsdcSzDecimals = converter.getSzDecimals("HYPE/USDC"); // spot → 2
 * const dexAbcSzDecimals = converter.getSzDecimals("test:ABC"); // builder dex (if enabled) → 0
 *
 * const spotPairId = converter.getSpotPairId("HFUN/USDC"); // → "@2"
 *
 * const symbol = converter.getSymbolBySpotPairId("@107"); // → "HYPE/USDC"
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids
 */
export class SymbolConverter {
  private _transport: IRequestTransport;
  private _dexOption: string[] | boolean;
  private _nameToAssetId = new Map<string, number>();
  private _nameToSzDecimals = new Map<string, number>();
  private _nameToSpotPairId = new Map<string, string>();
  private _spotPairIdToName = new Map<string, string>();
  private _outcomeNames = new Set<string>();
  private _reloadPromise: Promise<void> | undefined;

  /**
   * Creates a new SymbolConverter instance, but does not initialize it.
   * Run {@link reload} to load asset data or use {@link create} to create and initialize in one step.
   *
   * @param options Configuration options including transport and optional dex support.
   */
  constructor(options: SymbolConverterOptions) {
    this._transport = options.transport;
    this._dexOption = options.dexs ?? false;
  }

  /**
   * Create and initialize a SymbolConverter instance.
   *
   * @param options Configuration options including transport and optional dex support.
   * @return Initialized SymbolConverter instance.
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
   *
   * const transport = new HttpTransport(); // or `WebSocketTransport`
   * const converter = await SymbolConverter.create({ transport });
   * ```
   */
  static async create(options: SymbolConverterOptions): Promise<SymbolConverter> {
    const instance = new SymbolConverter(options);
    await instance.reload();
    return instance;
  }

  /**
   * Reload asset mappings from the API.
   *
   * Useful for refreshing data when new assets are added.
   */
  reload(): Promise<void> {
    // Prevent concurrent reloads: if a reload is already in progress, return the existing promise.
    if (this._reloadPromise) return this._reloadPromise;
    this._reloadPromise = this._reload().finally(() => {
      this._reloadPromise = undefined;
    });
    return this._reloadPromise;
  }

  private async _reload(): Promise<void> {
    const config = { transport: this._transport };
    const needDexs = this._dexOption === true || (Array.isArray(this._dexOption) && this._dexOption.length > 0);

    const [perpMetaData, spotMetaData, perpDexsData, outcomeMetaData] = await Promise.all([
      meta(config),
      spotMeta(config),
      needDexs ? perpDexs(config) : undefined,
      outcomeMeta(config),
    ]);

    // Build the new mappings into a private draft so readers keep observing the previously
    // published snapshot until the replacement is fully populated.
    const draft: SymbolConverterDraft = {
      nameToAssetId: new Map(),
      nameToSzDecimals: new Map(),
      nameToSpotPairId: new Map(),
      spotPairIdToName: new Map(),
      outcomeNames: new Set(),
    };

    this._processPerps(draft, perpMetaData);
    this._processSpot(draft, spotMetaData);
    this._processOutcomeMarkets(draft, outcomeMetaData);
    if (perpDexsData) await this._processBuilderDexs(draft, perpDexsData);

    // Publish atomically: no await may run between these assignments, so a concurrent
    // reader can never observe a half-built cache.
    this._nameToAssetId = draft.nameToAssetId;
    this._nameToSzDecimals = draft.nameToSzDecimals;
    this._nameToSpotPairId = draft.nameToSpotPairId;
    this._spotPairIdToName = draft.spotPairIdToName;
    this._outcomeNames = draft.outcomeNames;
  }

  // ============================================================
  // Perpetuals
  // ============================================================

  private _processPerps(draft: SymbolConverterDraft, perpMetaData: MetaResponse): void {
    perpMetaData.universe.forEach((asset, index) => {
      draft.nameToAssetId.set(asset.name, index);
      draft.nameToSzDecimals.set(asset.name, asset.szDecimals);
    });
  }

  // ============================================================
  // Spot
  // ============================================================

  private _processSpot(draft: SymbolConverterDraft, spotMetaData: SpotMetaResponse): void {
    const tokenMap = new Map<number, { name: string; szDecimals: number }>();
    spotMetaData.tokens.forEach((token) => {
      tokenMap.set(token.index, { name: token.name, szDecimals: token.szDecimals });
    });

    spotMetaData.universe.forEach((market) => {
      const baseToken = tokenMap.get(market.tokens[0]);
      const quoteToken = tokenMap.get(market.tokens[1]);
      if (!baseToken || !quoteToken) return;

      const assetId = 10000 + market.index;
      const baseQuoteKey = `${baseToken.name}/${quoteToken.name}`;

      draft.nameToAssetId.set(baseQuoteKey, assetId);
      draft.nameToSzDecimals.set(baseQuoteKey, baseToken.szDecimals);
      draft.nameToSpotPairId.set(baseQuoteKey, market.name);
      draft.spotPairIdToName.set(market.name, baseQuoteKey);
    });
  }

  // ============================================================
  // Builder dexs
  // ============================================================

  private async _processBuilderDexs(draft: SymbolConverterDraft, perpDexsData: PerpDexsResponse): Promise<void> {
    const builderDexs = perpDexsData
      .map((dex, index) => ({ dex, index }))
      .filter((item): item is { dex: NonNullable<PerpDexsResponse[number]>; index: number } => {
        return item.index > 0 && item.dex !== null && item.dex.name.length > 0;
      });
    if (builderDexs.length === 0) return;

    const dexsToProcess = Array.isArray(this._dexOption)
      ? builderDexs.filter((item) => (this._dexOption as string[]).includes(item.dex.name))
      : builderDexs;
    if (dexsToProcess.length === 0) return;

    const config = { transport: this._transport };
    const results = await Promise.allSettled(dexsToProcess.map((item) => meta(config, { dex: item.dex.name })));

    results.forEach((result, idx) => {
      if (result.status !== "fulfilled") return;

      const dexIndex = dexsToProcess[idx].index;
      const offset = 100000 + dexIndex * 10000;

      result.value.universe.forEach((asset, index) => {
        const assetId = offset + index;
        draft.nameToAssetId.set(asset.name, assetId);
        draft.nameToSzDecimals.set(asset.name, asset.szDecimals);
      });
    });
  }

  // ============================================================
  // Outcome markets
  // ============================================================

  private _processOutcomeMarkets(draft: SymbolConverterDraft, outcomeMetaData: OutcomeMetaResponse): void {
    // Map each named outcome to its owning question, which holds the price spec and bucket order
    const questionByOutcome = new Map<number, OutcomeMetaResponse["questions"][number]>();
    for (const question of outcomeMetaData.questions) {
      for (const outcomeId of question.namedOutcomes) {
        questionByOutcome.set(outcomeId, question);
      }
    }

    // Fallback outcomes are not tradable on their own and have no public slug
    const fallbackOutcomes = new Set(outcomeMetaData.questions.map((question) => question.fallbackOutcome));

    outcomeMetaData.outcomes.forEach((outcome) => {
      if (fallbackOutcomes.has(outcome.outcome)) return;
      const question = questionByOutcome.get(outcome.outcome);

      outcome.sideSpecs.forEach((sideSpec, sideIdx) => {
        const slug = this._outcomeSlug(outcome, sideSpec.name, question);
        if (!slug) return;

        draft.nameToAssetId.set(slug, 100000000 + 10 * outcome.outcome + sideIdx);
        // Outcome markets carry no precision field in outcomeMeta, and empirically their sizes
        // are whole integers: every observed resting book size is integer-valued and HIP-4
        // guides report fractional sizes rejected (no funded accept/reject probe was possible).
        // The lot precision is modeled as 0 decimals on that evidence — an observation of
        // current behavior, not a protocol guarantee.
        draft.nameToSzDecimals.set(slug, 0);
        draft.outcomeNames.add(slug);
      });
    });
  }

  /**
   * Builds the URL slug for an outcome side.
   *
   * Recurring price markets encode their slug in a `class:price*` description; every other market
   * derives it from the question, outcome, and side names (e.g. "nba-finals-game-3-san-antonio").
   */
  private _outcomeSlug(
    outcome: OutcomeMetaResponse["outcomes"][number],
    side: string,
    question?: OutcomeMetaResponse["questions"][number],
  ): string | null {
    if (outcome.description.includes("class:priceBinary")) {
      return this._recurringPriceSlug(outcome.description, side, 0);
    }
    if (question?.description.includes("class:priceBucket")) {
      return this._recurringPriceSlug(question.description, side, question.namedOutcomes.indexOf(outcome.outcome));
    }
    return [question?.name, outcome.name, side]
      .filter((part) => part !== undefined)
      .map((part) => this._slugify(part))
      .join("-");
  }

  /**
   * Builds the slug for a recurring price market from its `class:price*` description.
   *
   * @param spec Pipe-delimited recurring market spec (e.g. "class:priceBinary|underlying:BTC|expiry:...").
   * @param side Side name (e.g. "Yes").
   * @param bucketIndex Price range position for `priceBucket` markets (0 = below, 1 = between, 2 = above).
   * @return The generated slug, or `null` if the spec is incomplete or of an unknown class.
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications
   */
  private _recurringPriceSlug(spec: string, side: string, bucketIndex: number): string | null {
    const fields: Record<string, string> = {};
    for (const part of spec.split("|")) {
      const [key, ...value] = part.split(":");
      fields[key] = value.join(":");
    }

    const { class: assetClass, underlying, expiry } = fields;
    if (!assetClass || !underlying || !expiry) return null;

    // Expiry "YYYYMMDD-HHMM" becomes the slug date "mon-dd-HHMM"
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const date = `${months[Number(expiry.slice(4, 6)) - 1]}-${expiry.slice(6, 8)}-${expiry.slice(9, 13)}`;

    if (assetClass === "priceBinary") {
      const { targetPrice } = fields;
      if (!targetPrice) return null;
      return `${underlying}-above-${targetPrice}-${side}-${date}`.toLowerCase();
    }

    if (assetClass === "priceBucket") {
      const prices = fields.priceThresholds?.split(",");
      if (prices?.length !== 2) return null;

      let range: string;
      if (bucketIndex === 0) {
        range = `below-${prices[0]}`;
      } else if (bucketIndex === 1) {
        range = `${prices[0]}-to-${prices[1]}`;
      } else {
        range = `above-${prices[1]}`;
      }

      return `${underlying}-price-range-${date}-${range}-${side}`.toLowerCase();
    }

    return null;
  }

  /** Converts a market or side name to a URL slug. */
  private _slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/[\s-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get asset ID for a coin.
   * - For Perpetuals, use the coin name (e.g., "BTC").
   * - For Spots, use the "BASE/QUOTE" format (e.g., "HYPE/USDC").
   * - For Builder Dexs, use the "DEX_NAME:ASSET_NAME" format (e.g., "test:ABC").
   * - For Outcome Markets, use the slug as in the URL (e.g., "btc-above-61720-yes-jun-08-0600").
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
   *
   * const transport = new HttpTransport(); // or `WebSocketTransport`
   * const converter = await SymbolConverter.create({ transport });
   *
   * converter.getAssetId("BTC"); // → 0
   * converter.getAssetId("HYPE/USDC"); // → 10107
   * converter.getAssetId("test:ABC"); // → 110000
   * converter.getAssetId("btc-above-61720-yes-jun-08-0600"); // → 100002200
   * ```
   */
  getAssetId(name: string): number | undefined {
    return this._nameToAssetId.get(name);
  }

  /**
   * Get size decimals for a coin.
   * - For Perpetuals, use the coin name (e.g., "BTC").
   * - For Spots, use the "BASE/QUOTE" format (e.g., "HYPE/USDC").
   * - For Builder Dexs, use the "DEX_NAME:ASSET_NAME" format (e.g., "test:ABC").
   * - For Outcome Markets, use the slug as in the URL (e.g., "btc-above-61720-yes-jun-08-0600").
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
   *
   * const transport = new HttpTransport(); // or `WebSocketTransport`
   * const converter = await SymbolConverter.create({ transport });
   *
   * converter.getSzDecimals("BTC"); // → 5
   * converter.getSzDecimals("HYPE/USDC"); // → 2
   * converter.getSzDecimals("test:ABC"); // → 0
   * converter.getSzDecimals("btc-above-61720-yes-jun-08-0600"); // → 0 (empirically integer sizes, not protocol-guaranteed)
   * ```
   */
  getSzDecimals(name: string): number | undefined {
    return this._nameToSzDecimals.get(name);
  }

  /**
   * Get spot pair ID (e.g., @2) for info endpoints and subscriptions (e.g., l2book, trades).
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
   *
   * const transport = new HttpTransport(); // or `WebSocketTransport`
   * const converter = await SymbolConverter.create({ transport });
   *
   * converter.getSpotPairId("HFUN/USDC"); // → "@2"
   * converter.getSpotPairId("PURR/USDC"); // → "PURR/USDC" (exceptions exist for some pairs)
   * ```
   */
  getSpotPairId(name: string): string | undefined {
    return this._nameToSpotPairId.get(name);
  }

  /**
   * Get the symbol ("BASE/QUOTE") from a spot pair ID (e.g., @107).
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
   *
   * const transport = new HttpTransport(); // or `WebSocketTransport`
   * const converter = await SymbolConverter.create({ transport });
   *
   * converter.getSymbolBySpotPairId("@107"); // → "HYPE/USDC"
   * converter.getSymbolBySpotPairId("PURR/USDC"); // → "PURR/USDC" (exceptions exist for some pairs)
   * ```
   */
  getSymbolBySpotPairId(pairId: string): string | undefined {
    return this._spotPairIdToName.get(pairId);
  }

  /**
   * Get the tick size (smallest valid price increment) for a coin at a given price level, per the
   * {@link https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size | tick rules}:
   * - Maximum 5 significant figures
   * - Maximum 6 (perp) or 8 (spot) - `szDecimals` decimal places
   * - Integer prices are exempt from the significant-figure cap, so the tick is never larger than `1`
   *
   * The tick is constant within each power-of-ten decade and steps with the price magnitude, so the
   * price argument matters: the tick at `0.0001` differs from the tick at `12345`.
   *
   * Outcome markets (slugs such as `"btc-above-64570-yes-jul-27-0300"`) share the spot
   * implementation per the official asset-ID docs: with their integer lot (`szDecimals` 0) the
   * tick is `max(10^(floor(log10(px)) - 4), 1e-8)` — `0.00001` at `0.68`, `0.000001` at `0.05`,
   * and `0.00000001` at `0.00001`, where the 8-decimal ceiling clamps the bare formula.
   *
   * Accepts the same name formats as {@link SymbolConverter.getSzDecimals} and likewise returns
   * `undefined` for an unknown coin (a spot pair ID like `"@107"` is unknown here — use `"HYPE/USDC"`).
   *
   * @param name The coin (e.g., "BTC", "HYPE/USDC", "test:ABC").
   * @param price The price level at which to measure the tick (as string or number).
   * @return Tick size as a decimal string (e.g., "1", "0.0001"), or `undefined` for an unknown coin.
   *
   * @throws {FormatError} If the price is not a valid finite number greater than 0.
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
   *
   * const transport = new HttpTransport(); // or `WebSocketTransport`
   * const converter = await SymbolConverter.create({ transport });
   *
   * converter.getTickSize("BTC", "97123.4"); // → "1" (perp, szDecimals=5)
   * converter.getTickSize("PURR/USDC", "0.0001"); // → "0.00000001" (spot, 8-decimal ceiling)
   * converter.getTickSize("BTC", "123456"); // → "1" (integers bypass the sig-fig cap)
   * ```
   */
  getTickSize(name: string, price: number | string): string | undefined {
    const szDecimals = this._nameToSzDecimals.get(name);
    if (szDecimals === undefined) return undefined;

    const d = toPriceDecimal(price);
    // Spot markets carry a spot pair ID; outcome markets share the spot implementation (official
    // asset-ID docs); everything else (perps, builder dexs) uses the perp formula.
    const spotLike = this._nameToSpotPairId.has(name) || this._outcomeNames.has(name);
    const tickExp = tickExponent(d, Math.max((spotLike ? 8 : 6) - szDecimals, 0));

    // 10^tickExp in the normalized form: a single "1" digit at exponent tickExp + 1.
    return toFixed({ sign: 1, digits: "1", exp: tickExp + 1 });
  }

  /**
   * Round a price to a valid tick for a coin, choosing the rounding direction by order side.
   *
   * Unlike {@link formatPrice} — which always truncates — this helper guarantees a direction:
   * - Default (maker-safe): rounds **against** the trade direction, so the rounded price is never more
   *   aggressive than requested. A **buy rounds DOWN** (never pays more) and a **sell rounds UP**
   *   (never sells for less); the order stays on your side of the spread.
   * - `aggressive: true` (taker): flips both directions — a **buy rounds UP** and a **sell rounds DOWN** —
   *   trading up to one tick of price for a better chance to cross the spread and fill immediately.
   *
   * A price already on the tick grid is returned unchanged. All math is exact string arithmetic
   * (the tick is a power of ten, so rounding is digit truncation or a one-digit increment),
   * so no floating-point artifacts can appear.
   *
   * Outcome markets (slugs such as `"btc-above-64570-yes-jul-27-0300"`) share the spot
   * implementation per the official asset-ID docs, so the spot-like tick applies to them:
   * `max(10^(floor(log10(px)) - 4), 1e-8)` (5 significant figures, 8-decimal ceiling).
   *
   * Accepts the same name formats as {@link SymbolConverter.getSzDecimals} and likewise returns
   * `undefined` for an unknown coin.
   *
   * @param name The coin (e.g., "BTC", "HYPE/USDC", "test:ABC").
   * @param side Order side: "buy" or "sell".
   * @param price The price to round (as string or number).
   * @param opts See {@link RoundPriceOptions}.
   * @return Rounded price as a decimal string, or `undefined` for an unknown coin.
   *
   * @throws {FormatError} If the price is not a valid finite number greater than 0, or rounds to 0.
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   * import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
   *
   * const transport = new HttpTransport(); // or `WebSocketTransport`
   * const converter = await SymbolConverter.create({ transport });
   *
   * converter.roundPrice("BTC", "buy", "97123.456"); // → "97123" (never pays more)
   * converter.roundPrice("BTC", "sell", "97123.456"); // → "97124" (never sells for less)
   * converter.roundPrice("BTC", "buy", "97123.456", { aggressive: true }); // → "97124" (taker)
   * converter.roundPrice("BTC", "buy", "97123"); // → "97123" (already on the tick)
   * ```
   */
  roundPrice(name: string, side: "buy" | "sell", price: number | string, opts?: RoundPriceOptions): string | undefined {
    const szDecimals = this._nameToSzDecimals.get(name);
    if (szDecimals === undefined) return undefined;

    const d = toPriceDecimal(price);
    // Spot markets carry a spot pair ID; outcome markets share the spot implementation (official
    // asset-ID docs); everything else (perps, builder dexs) uses the perp formula.
    const spotLike = this._nameToSpotPairId.has(name) || this._outcomeNames.has(name);
    const tickExp = tickExponent(d, Math.max((spotLike ? 8 : 6) - szDecimals, 0));

    // Maker-safe default rounds against the trade direction (buy down, sell up); aggressive flips both.
    const roundUp = side === "buy" ? (opts?.aggressive ?? false) : !(opts?.aggressive ?? false);
    const result = roundToTick(d, tickExp, roundUp);

    if (result.digits === "") {
      throw new FormatError("Price is too small and was rounded to 0");
    }

    return toFixed(result);
  }
}
