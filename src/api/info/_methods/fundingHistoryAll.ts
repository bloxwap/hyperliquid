// ============================================================
// Execution Logic
// ============================================================

import { collectPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import type { FundingHistoryParameters, FundingHistoryResponse } from "./fundingHistory.ts";
import { fundingHistoryPages } from "./fundingHistoryPages.ts";

/** Request parameters for the {@linkcode fundingHistoryAll} function. */
export type FundingHistoryAllParameters = FundingHistoryParameters;

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request all funding history, automatically paginating through the server's 500-records-per-response cap.
 *
 * Repeatedly calls {@linkcode fundingHistory}, re-requesting from the last returned timestamp
 * (`startTime` is inclusive) after each full page — the overlap is discarded, matched by the
 * record's `time` (there is exactly one funding record per coin per funding interval) — and
 * concatenates the pages. Stops at the first short page, when `options.maxPages` pages have been
 * fetched, or when a page contributes nothing new, so a misbehaving server causes neither
 * duplicates nor an infinite loop.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Array of historical funding rate records for an asset.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { fundingHistoryAll } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await fundingHistoryAll({ transport }, {
 *   coin: "ETH",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-historical-funding-rates
 */
export function fundingHistoryAll(
  config: InfoConfig,
  params: FundingHistoryAllParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): Promise<FundingHistoryResponse> {
  return collectPages(fundingHistoryPages(config, params, options, signal));
}
