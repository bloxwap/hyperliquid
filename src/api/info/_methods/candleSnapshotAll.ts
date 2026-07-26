// ============================================================
// Execution Logic
// ============================================================

import { fetchAllPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import { candleSnapshot, type CandleSnapshotParameters, type CandleSnapshotResponse } from "./candleSnapshot.ts";

/** Request parameters for the {@linkcode candleSnapshotAll} function. */
export type CandleSnapshotAllParameters = CandleSnapshotParameters;

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request candlestick snapshots over a time range, automatically paginating until the range is exhausted.
 *
 * Repeatedly calls {@linkcode candleSnapshot}, re-requesting from the last returned candle's
 * opening time (`startTime` is inclusive) after each full page — the overlap is discarded,
 * matched by the candle's opening time `t` (exactly one candle exists per interval per opening
 * time) — and concatenates the pages. Stops at the first short page, when `options.maxPages`
 * pages have been fetched, or when a page contributes nothing new, so a misbehaving server
 * causes neither duplicates nor an infinite loop.
 *
 * Note: only the most recent 5000 candles are available from the server — that window is an
 * availability limit, not a pagination cap, so older history cannot be reached by paginating.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Array of candlestick data points.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { candleSnapshotAll } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await candleSnapshotAll({ transport }, {
 *   coin: "ETH",
 *   interval: "1h",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot
 */
export function candleSnapshotAll(
  config: InfoConfig,
  params: CandleSnapshotAllParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): Promise<CandleSnapshotResponse> {
  return fetchAllPages(
    (startTime) => candleSnapshot(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    5000, // only the most recent 5000 candles are available, so a full window arrives as one page
    (candle) => candle.t,
    (candle) => String(candle.t), // one candle per interval per opening time: t is the identity
    options,
  );
}
