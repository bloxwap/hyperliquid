// ============================================================
// Execution Logic
// ============================================================

import { fetchPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import { candleSnapshot, type CandleSnapshotParameters, type CandleSnapshotResponse } from "./candleSnapshot.ts";

/** Request parameters for the {@linkcode candleSnapshotPages} function. */
export type CandleSnapshotPagesParameters = CandleSnapshotParameters;

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request candlestick snapshots over a time range as a lazy stream of pages.
 *
 * Streaming form of {@linkcode candleSnapshotAll}: same walk — re-requesting from the last
 * returned candle's opening time (`startTime` is inclusive) after each full page, discarding the
 * overlap matched by the candle's opening time `t` (exactly one candle exists per interval per
 * opening time) — but each page is yielded as it arrives instead of buffering the whole range.
 * Nothing is requested until iteration starts, and breaking out of the loop stops the walk
 * without further requests. Ends at the first short page, when `options.maxPages` pages have been
 * fetched, or when a page contributes nothing new, so a misbehaving server causes neither
 * duplicates nor an infinite loop.
 *
 * Note: only the most recent 5000 candles are available from the server — that window is an
 * availability limit, not a pagination cap, so older history cannot be reached by paginating.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Async generator yielding pages of candlestick data points.
 *
 * @throws {ValidationError} When the pagination options fail validation (thrown by the first
 *   `next()` call, before any request is sent).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { candleSnapshotPages } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * for await (const page of candleSnapshotPages({ transport }, {
 *   coin: "ETH",
 *   interval: "1h",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * })) {
 *   console.log(`received ${page.length} candles`);
 * }
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot
 */
export function candleSnapshotPages(
  config: InfoConfig,
  params: CandleSnapshotPagesParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): AsyncGenerator<CandleSnapshotResponse, void, undefined> {
  return fetchPages(
    (startTime) => candleSnapshot(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    5000, // only the most recent 5000 candles are available, so a full window arrives as one page
    (candle) => candle.t,
    (candle) => String(candle.t), // one candle per interval per opening time: t is the identity
    options,
  );
}
