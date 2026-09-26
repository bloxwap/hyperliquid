// ============================================================
// Execution Logic
// ============================================================

import { fetchPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import { fundingHistory, type FundingHistoryParameters, type FundingHistoryResponse } from "./fundingHistory.ts";

/** Request parameters for the {@linkcode fundingHistoryPages} function. */
export type FundingHistoryPagesParameters = FundingHistoryParameters;

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request funding history as a lazy stream of pages, paginating through the server's 500-records-per-response cap.
 *
 * Streaming form of {@linkcode fundingHistoryAll}: same walk — re-requesting from the last
 * returned timestamp (`startTime` is inclusive) after each full page, discarding the overlap
 * matched by the record's `time` (there is exactly one funding record per coin per funding
 * interval) — but each page is yielded as it arrives instead of buffering the whole range.
 * Nothing is requested until iteration starts, and breaking out of the loop stops the walk
 * without further requests. Ends at the first short page, when `options.maxPages` pages have been
 * fetched, or when a page contributes nothing new, so a misbehaving server causes neither
 * duplicates nor an infinite loop.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Async generator yielding pages of historical funding rate records for an asset.
 *
 * @throws {ValidationError} When the pagination options fail validation (thrown by the first
 *   `next()` call, before any request is sent).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { fundingHistoryPages } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * for await (const page of fundingHistoryPages({ transport }, {
 *   coin: "ETH",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * })) {
 *   console.log(`received ${page.length} funding records`);
 * }
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-historical-funding-rates
 */
export function fundingHistoryPages(
  config: InfoConfig,
  params: FundingHistoryPagesParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): AsyncGenerator<FundingHistoryResponse, void, undefined> {
  return fetchPages(
    (startTime) => fundingHistory(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    500, // the server returns at most 500 funding records per response
    (record) => record.time,
    (record) => String(record.time), // one funding record per coin per interval: time is the identity
    options,
  );
}
