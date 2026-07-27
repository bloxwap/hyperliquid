// ============================================================
// Execution Logic
// ============================================================

import { fetchAllPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import {
  userNonFundingLedgerUpdates,
  type UserNonFundingLedgerUpdatesParameters,
  type UserNonFundingLedgerUpdatesResponse,
} from "./userNonFundingLedgerUpdates.ts";

/** Request parameters for the {@linkcode userNonFundingLedgerUpdatesAll} function. */
export type UserNonFundingLedgerUpdatesAllParameters = Omit<UserNonFundingLedgerUpdatesParameters, "startTime"> & {
  /** Start time (in ms since epoch). */
  startTime: string | number;
};

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request all user non-funding ledger updates, automatically paginating through the server's per-response cap.
 *
 * Repeatedly calls {@linkcode userNonFundingLedgerUpdates}, re-requesting from the last returned
 * timestamp (`startTime` is inclusive) after each full page — the overlap is discarded, matched
 * by the update's L1 transaction `hash` and `time` (one L1 transaction produces at most one
 * non-funding ledger update per user) — and concatenates the pages. Stops at the first short
 * page, when `options.maxPages` pages have been fetched, or when a page contributes nothing new,
 * so a misbehaving server causes neither duplicates nor an infinite loop.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Array of user's non-funding ledger update.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userNonFundingLedgerUpdatesAll } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userNonFundingLedgerUpdatesAll({ transport }, {
 *   user: "0x...",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
 */
export function userNonFundingLedgerUpdatesAll(
  config: InfoConfig,
  params: UserNonFundingLedgerUpdatesAllParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): Promise<UserNonFundingLedgerUpdatesResponse> {
  return fetchAllPages(
    (startTime) => userNonFundingLedgerUpdates(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    500, // time-ranged responses are documented to return at most 500 elements
    (update) => update.time,
    (update) => `${update.hash}:${update.time}`, // one non-funding ledger update per user per L1 tx
    options,
  );
}
