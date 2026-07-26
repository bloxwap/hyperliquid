// ============================================================
// Execution Logic
// ============================================================

import { fetchAllPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import {
  userTwapSliceFillsByTime,
  type UserTwapSliceFillsByTimeParameters,
  type UserTwapSliceFillsByTimeResponse,
} from "./userTwapSliceFillsByTime.ts";

/** Request parameters for the {@linkcode userTwapSliceFillsByTimeAll} function. */
export type UserTwapSliceFillsByTimeAllParameters = UserTwapSliceFillsByTimeParameters;

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request all user TWAP slice fills by time, automatically paginating through the server's per-response cap.
 *
 * Repeatedly calls {@linkcode userTwapSliceFillsByTime}, re-requesting from the last returned
 * timestamp (`startTime` is inclusive) after each full page — the overlap is discarded, matched
 * by the nested fill's `tid`, which is unique per fill — and concatenates the pages. Stops at the
 * first short page, when `options.maxPages` pages have been fetched, or when a page contributes
 * nothing new, so a misbehaving server causes neither duplicates nor an infinite loop.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Array of user's TWAP slice fill by time.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userTwapSliceFillsByTimeAll } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userTwapSliceFillsByTimeAll({ transport }, {
 *   user: "0x...",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
 */
export function userTwapSliceFillsByTimeAll(
  config: InfoConfig,
  params: UserTwapSliceFillsByTimeAllParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): Promise<UserTwapSliceFillsByTimeResponse> {
  return fetchAllPages(
    (startTime) => userTwapSliceFillsByTime(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    500, // time-ranged responses are documented to return at most 500 elements
    (sliceFill) => sliceFill.fill.time,
    (sliceFill) => String(sliceFill.fill.tid), // `tid` is the documented unique identifier of a fill
    options,
  );
}
