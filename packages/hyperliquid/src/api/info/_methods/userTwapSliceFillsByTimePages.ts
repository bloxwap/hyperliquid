// ============================================================
// Execution Logic
// ============================================================

import { fetchPages, type InfoConfig, type PaginationOptions } from "./_base/mod.ts";
import {
  userTwapSliceFillsByTime,
  type UserTwapSliceFillsByTimeParameters,
  type UserTwapSliceFillsByTimeResponse,
} from "./userTwapSliceFillsByTime.ts";

/** Request parameters for the {@linkcode userTwapSliceFillsByTimePages} function. */
export type UserTwapSliceFillsByTimePagesParameters = UserTwapSliceFillsByTimeParameters;

export type { PaginationOptions } from "./_base/mod.ts";

/**
 * Request user TWAP slice fills by time as a lazy stream of pages, paginating through the server's per-response cap.
 *
 * Streaming form of {@linkcode userTwapSliceFillsByTimeAll}: same walk — re-requesting from the
 * last returned timestamp (`startTime` is inclusive) after each full page, discarding the overlap
 * matched by the nested fill's `tid`, which is unique per fill — but each page is yielded as it
 * arrives instead of buffering the whole range. Nothing is requested until iteration starts, and
 * breaking out of the loop stops the walk without further requests. Ends at the first short page,
 * when `options.maxPages` pages have been fetched, or when a page contributes nothing new, so a
 * misbehaving server causes neither duplicates nor an infinite loop.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param options Pagination options (see {@linkcode PaginationOptions}).
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Async generator yielding pages of user's TWAP slice fill by time.
 *
 * @throws {ValidationError} When the pagination options fail validation (thrown by the first
 *   `next()` call, before any request is sent).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userTwapSliceFillsByTimePages } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * for await (const page of userTwapSliceFillsByTimePages({ transport }, {
 *   user: "0x...",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
 * })) {
 *   console.log(`received ${page.length} TWAP slice fills`);
 * }
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
 */
export function userTwapSliceFillsByTimePages(
  config: InfoConfig,
  params: UserTwapSliceFillsByTimePagesParameters,
  options?: PaginationOptions,
  signal?: AbortSignal,
): AsyncGenerator<UserTwapSliceFillsByTimeResponse, void, undefined> {
  return fetchPages(
    (startTime) => userTwapSliceFillsByTime(config, { ...params, startTime }, signal),
    Number(params.startTime), // valibot input allows `string | number`; the walk needs a number
    500, // time-ranged responses are documented to return at most 500 elements
    (sliceFill) => sliceFill.fill.time,
    (sliceFill) => String(sliceFill.fill.tid), // `tid` is the documented unique identifier of a fill
    options,
  );
}
