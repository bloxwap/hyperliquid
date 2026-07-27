// ============================================================
// Execution Logic
// ============================================================

import * as v from "valibot";
import { parse } from "../../../_base.ts";
import { fetchAllPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import { userFillsByTime, type UserFillsByTimeParameters, type UserFillsByTimeResponse } from "./userFillsByTime.ts";

/** Request parameters for the {@linkcode userFillsByTimeAll} function. */
export type UserFillsByTimeAllParameters = Omit<UserFillsByTimeParameters, "reversed"> & {
  /**
   * Not supported by the paginated helper: pagination walks forward from `startTime` and needs
   * ascending pages, while the window a `reversed` response is drawn from is undocumented.
   */
  reversed?: false;
};

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request all user fills by time, automatically paginating through the server's 2000-fills-per-response cap.
 *
 * Repeatedly calls {@linkcode userFillsByTime}, re-requesting from the last returned timestamp
 * (`startTime` is inclusive) after each full page — the overlap is discarded, matched by fill
 * `tid`, which is unique per fill — and concatenates the pages. Stops at the first short page,
 * when `options.maxPages` pages have been fetched, or when a page contributes nothing new, so a
 * misbehaving server causes neither duplicates nor an infinite loop.
 *
 * Note: only the 10000 most recent fills are available from the server, regardless of pagination.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Array of user trade fills by time.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userFillsByTimeAll } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userFillsByTimeAll({ transport }, {
 *   user: "0x...",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-fills-by-time
 */
export function userFillsByTimeAll(
  config: InfoConfig,
  params: UserFillsByTimeAllParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): Promise<UserFillsByTimeResponse> {
  // `reversed` is excluded at the type level; this rejects it for untyped callers, before any request.
  parse(
    v.optional(
      v.literal(
        false,
        "`reversed: true` is not supported: pagination walks forward from `startTime` and needs ascending pages.",
      ),
    ),
    params.reversed,
  );
  return fetchAllPages(
    (startTime) => userFillsByTime(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    2000, // the server returns at most 2000 fills per response
    (fill) => fill.time,
    (fill) => String(fill.tid), // `tid` is the documented unique identifier of a (partial) fill
    options,
  );
}
