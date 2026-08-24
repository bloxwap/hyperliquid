/**
 * Opt-in TTL cache for slow-changing Info API endpoints.
 *
 * {@link InfoCacheTransport} wraps any {@link IRequestTransport} — HTTP or WebSocket — and answers
 * repeated requests to a conservative allowlist of slow-changing info endpoints (`meta`, `spotMeta`,
 * `allPerpMetas`, `perpDexs`, `marginTable`, `tokenDetails`, `outcomeMeta`, `outcomeTemplates`)
 * from an in-memory cache instead of the network. Everything else — user state, order books,
 * `exchange` and `explorer` requests — passes straight through. The wrapper is strictly opt-in:
 * without it, behavior is byte-for-byte the default.
 *
 * ```text
 * InfoCacheTransport.request():
 *   endpoint !== "info" or type not allowlisted ─► inner transport (no cache, no overhead)
 *   allowlisted ─► key = type + sorted params
 *     ├─ fresh entry ─► cached promise
 *     └─ miss/expired ─► inner transport ─► cache promise (TTL from dispatch)
 *                        ├─ resolves ─► served until expiry
 *                        └─ rejects ─► evicted (next call retries)
 * ```
 *
 * @module
 */

import type { IRequestTransport } from "./_base.ts";

/**
 * Info request types whose responses {@linkcode InfoCacheTransport} may cache.
 *
 * The allowlist is deliberately conservative — every type on it returns deployment- or
 * listing-driven data that changes rarely and never within seconds:
 *
 * - `meta` — perp universe and margin tables (per DEX; the `dex` param is part of the cache key).
 * - `spotMeta` — spot token/pair universe.
 * - `allPerpMetas` — perp metas across all DEXs.
 * - `perpDexs` — builder DEX registry.
 * - `marginTable` — margin tiers per table `id` (and `dex`); both params are part of the key.
 * - `tokenDetails` — genesis/deployer metadata per `tokenId`; static after deploy.
 * - `outcomeMeta` — prediction-market outcome/question metadata.
 * - `outcomeTemplates` — outcome deployer templates.
 *
 * Deliberately NOT cached: `metaAndAssetCtxs`/`spotMetaAndAssetCtxs` (asset contexts carry live
 * prices and funding), `exchangeStatus`, `validatorSummaries`, `perpDeployAuctionStatus`, and every
 * user-state or order-book endpoint — staleness there is either wrong data or a trading hazard.
 */
export type InfoCacheableRequestType =
  | "meta"
  | "spotMeta"
  | "allPerpMetas"
  | "perpDexs"
  | "marginTable"
  | "tokenDetails"
  | "outcomeMeta"
  | "outcomeTemplates";

/** Configuration options for {@linkcode InfoCacheTransport}. */
export interface InfoCacheOptions {
  /**
   * Time-to-live in ms applied to every allowlisted endpoint unless overridden in
   * {@linkcode InfoCacheOptions.ttlByType}. Must be a non-negative number; `Infinity` caches
   * forever (until {@linkcode InfoCacheTransport.clear}); `0` effectively disables caching.
   *
   * Metadata changes are listing- or deployment-driven — rare, but unannounced — so the useful
   * band is seconds to minutes, not hours. As a guide: `meta`/`spotMeta`/`allPerpMetas`/
   * `outcomeMeta` sit well at 30 s – 5 min; `marginTable`, `perpDexs`, `tokenDetails` and
   * `outcomeTemplates` are near-static and tolerate 5 – 10 min or more.
   *
   * Default: `60_000` (1 minute)
   */
  ttl?: number;
  /**
   * Per-endpoint TTL overrides in ms, keyed by info request type; falls back to
   * {@linkcode InfoCacheOptions.ttl} for types not listed.
   *
   * Default: `{}` (every allowlisted endpoint uses `ttl`)
   *
   * @example
   * ```ts
   * const transport = new InfoCacheTransport(new HttpTransport(), {
   *   ttl: 30_000, // meta family refreshes often
   *   ttlByType: { marginTable: 600_000, tokenDetails: 600_000 }, // near-static tables
   * });
   * ```
   */
  ttlByType?: Partial<Record<InfoCacheableRequestType, number>>;
  /**
   * Maximum number of cached entries. Entries are keyed by request type AND params, so
   * param-distinct calls (`tokenDetails` over many token IDs, `marginTable` over many tables)
   * accumulate; beyond the limit the wrapper first drops expired entries, then the oldest ones.
   * Must be a positive integer.
   *
   * Default: `1000`
   */
  maxSize?: number;
}

/** One cached response: the in-flight or settled promise plus its expiry. */
interface CacheEntry {
  promise: Promise<unknown>;
  expiresAt: number;
}

/**
 * Opt-in caching wrapper around any {@linkcode IRequestTransport}, TTL-caching the slow-changing
 * info endpoints listed in {@linkcode InfoCacheableRequestType}.
 *
 * Cache keys incorporate the full request payload (params sorted), so e.g. `marginTable` with
 * different `id`/`dex` values never collide. Concurrent identical calls share one in-flight
 * request; note that the first caller's abort signal drives that shared request, so aborting it
 * rejects every waiter and evicts the entry (the next call simply refetches). A rejected request
 * is never served from cache. Cached responses ignore later callers' signals — a hit needs no
 * network at all.
 *
 * The wrapper implements only {@linkcode IRequestTransport}: wrapping a `WebSocketTransport`
 * hides its subscription interface, so pass the raw WebSocket transport to `SubscriptionClient`
 * and the wrapped one to `InfoClient`.
 *
 * Note on `SymbolConverter`: it fetches `meta`/`spotMeta`/`perpDexs`/`outcomeMeta` through
 * whatever transport it is given. If that transport is an `InfoCacheTransport`, `reload()`
 * serves cached data within the TTL — give the converter its own unwrapped transport, or call
 * {@linkcode clear} first, when a reload must see fresh listings.
 *
 * @example
 * ```ts
 * import { HttpTransport, InfoCacheTransport, InfoClient } from "@bloxwap/hyperliquid";
 *
 * const transport = new InfoCacheTransport(new HttpTransport(), {
 *   ttl: 60_000, // default; override per endpoint via ttlByType
 * });
 * const client = new InfoClient({ transport });
 *
 * await client.meta(); // hits the network
 * await client.meta(); // served from cache
 * ```
 */
export class InfoCacheTransport<E extends "info" | "exchange" | "explorer" = "info" | "exchange">
  implements IRequestTransport<E>
{
  /** The wrapped transport every uncached request is delegated to. */
  readonly inner: IRequestTransport<E>;
  /** Default TTL in ms. */
  private readonly _ttl: number;
  /** Per-type TTL overrides in ms. */
  private readonly _ttlByType: Partial<Record<InfoCacheableRequestType, number>>;
  /** Maximum number of cached entries before eviction. */
  private readonly _maxSize: number;
  /** Cached responses keyed by type + sorted params, in insertion order (oldest first). */
  private readonly _entries = new Map<string, CacheEntry>();

  /**
   * Creates a caching wrapper around `inner`.
   *
   * @param inner The transport to delegate uncached requests and cache misses to.
   * @param options Cache configuration. See {@link InfoCacheOptions}.
   */
  constructor(inner: IRequestTransport<E>, options?: InfoCacheOptions) {
    const { ttl = 60_000, ttlByType = {}, maxSize = 1000 } = options ?? {};
    if (
      typeof ttl !== "number" ||
      Number.isNaN(ttl) ||
      ttl < 0 ||
      Object.values(ttlByType).some((t) => typeof t !== "number" || Number.isNaN(t) || t < 0)
    ) {
      throw new RangeError("InfoCacheTransport: ttl values must be non-negative numbers");
    }
    if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
      throw new RangeError(`InfoCacheTransport: maxSize must be a positive integer (got ${maxSize})`);
    }
    this.inner = inner;
    this._ttl = ttl;
    this._ttlByType = ttlByType;
    this._maxSize = maxSize;
  }

  /** Indicates this transport uses testnet endpoint(s) — mirrors the wrapped transport. */
  get isTestnet(): boolean {
    return this.inner.isTestnet;
  }

  /**
   * Sends a request, answering allowlisted info requests from the cache while fresh.
   *
   * @param endpoint The API endpoint to send the request to.
   * @param payload The payload to send with the request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return A promise that resolves with the parsed response payload.
   */
  request<T>(endpoint: E, payload: unknown, signal?: AbortSignal): Promise<T> {
    const type = endpoint === "info" ? cacheableType(payload) : undefined;
    if (type === undefined) return this.inner.request<T>(endpoint, payload, signal);

    const key = stableKey(payload as Record<string, unknown>);
    const now = Date.now();
    const hit = this._entries.get(key);
    if (hit !== undefined && hit.expiresAt > now) return hit.promise as Promise<T>;

    // Cache the in-flight promise itself, so concurrent identical calls share one request. The
    // TTL runs from dispatch: a response is served until `ttl` after its request started, and a
    // rejection evicts the entry (guarded against evicting a newer entry for the same key).
    const promise = this.inner.request<T>(endpoint, payload, signal);
    const entry: CacheEntry = { promise, expiresAt: now + (this._ttlByType[type] ?? this._ttl) };
    this._entries.delete(key); // re-insert so eviction order tracks recency
    this._evict(now);
    this._entries.set(key, entry);
    promise.catch(() => {
      if (this._entries.get(key) === entry) this._entries.delete(key);
    });
    return promise;
  }

  /** Drops every cached entry; the next call to any allowlisted endpoint refetches. */
  clear(): void {
    this._entries.clear();
  }

  /** Makes room for one more entry: expired entries first, then the oldest. */
  private _evict(now: number): void {
    if (this._entries.size < this._maxSize) return;
    for (const [key, entry] of this._entries) {
      if (this._entries.size < this._maxSize) return;
      if (entry.expiresAt <= now) this._entries.delete(key);
    }
    while (this._entries.size >= this._maxSize) {
      const oldest = this._entries.keys().next();
      if (oldest.done === true) return;
      this._entries.delete(oldest.value);
    }
  }
}

/** Info request types eligible for caching, as a runtime set. */
const CACHEABLE_TYPES: ReadonlySet<string> = new Set([
  "meta",
  "spotMeta",
  "allPerpMetas",
  "perpDexs",
  "marginTable",
  "tokenDetails",
  "outcomeMeta",
  "outcomeTemplates",
]);

/** The payload's `type` when it names an allowlisted info request, otherwise `undefined`. */
function cacheableType(payload: unknown): InfoCacheableRequestType | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const type = (payload as Record<string, unknown>).type;
  return typeof type === "string" && CACHEABLE_TYPES.has(type) ? (type as InfoCacheableRequestType) : undefined;
}

/**
 * Cache key for a payload: a JSON form with object keys sorted at every depth, so two payloads
 * that differ only in key insertion order (`{ id, dex }` vs `{ dex, id }`) share one entry.
 * Payloads reaching this wrapper are small plain-data records validated by the request schemas.
 */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const field = record[key];
      if (field === undefined) continue; // mirrors JSON.stringify dropping undefined object values
      parts.push(`${JSON.stringify(key)}:${stableKey(field)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
