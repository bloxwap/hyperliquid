// ============================================================
// Execution Logic
// ============================================================

import { fetchPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import {
  userNonFundingLedgerUpdates,
  type UserNonFundingLedgerUpdatesParameters,
  type UserNonFundingLedgerUpdatesResponse,
} from "./userNonFundingLedgerUpdates.ts";

/** Request parameters for the {@linkcode userNonFundingLedgerUpdatesPages} function. */
export type UserNonFundingLedgerUpdatesPagesParameters = Omit<UserNonFundingLedgerUpdatesParameters, "startTime"> & {
  /** Start time (in ms since epoch). */
  startTime: string | number;
};

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request user non-funding ledger updates as a lazy stream of pages, paginating through the server's per-response cap.
 *
 * Streaming form of {@linkcode userNonFundingLedgerUpdatesAll}: same walk — re-requesting from
 * the last returned timestamp (`startTime` is inclusive) after each full page, discarding the
 * overlap matched by the update's L1 transaction `hash` and `time` (one L1 transaction produces
 * at most one non-funding ledger update per user) — but each page is yielded as it arrives
 * instead of buffering the whole range. Nothing is requested until iteration starts, and breaking
 * out of the loop stops the walk without further requests. Ends at the first short page, when
 * `options.maxPages` pages have been fetched, or when a page contributes nothing new, so a
 * misbehaving server causes neither duplicates nor an infinite loop.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Async generator yielding pages of user's non-funding ledger update.
 *
 * @throws {ValidationError} When the pagination options fail validation (thrown by the first
 *   `next()` call, before any request is sent).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userNonFundingLedgerUpdatesPages } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * for await (const page of userNonFundingLedgerUpdatesPages({ transport }, {
 *   user: "0x...",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * })) {
 *   console.log(`received ${page.length} ledger updates`);
 * }
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
 */
export function userNonFundingLedgerUpdatesPages(
  config: InfoConfig,
  params: UserNonFundingLedgerUpdatesPagesParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): AsyncGenerator<UserNonFundingLedgerUpdatesResponse, void, undefined> {
  return fetchPages(
    (startTime) => userNonFundingLedgerUpdates(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    500, // time-ranged responses are documented to return at most 500 elements
    (update) => update.time,
    (update) => `${update.hash}:${update.time}`, // one non-funding ledger update per user per L1 tx
    options,
  );
}
