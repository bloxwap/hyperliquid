/**
 * Pagination support for time-ranged Info API endpoints.
 *
 * Time-ranged responses are capped server-side (see each `*All`/`*Pages` helper for its endpoint's
 * page size), and the documented way to read a larger range is to re-request with `startTime` set
 * to the last returned timestamp (`startTime` is inclusive). {@linkcode fetchPages} drives that
 * loop as an async generator: it re-requests the boundary timestamp and discards the records it
 * has already yielded, so a page capped in the middle of a same-millisecond cluster neither skips
 * the cluster's remainder nor duplicates the overlap. {@linkcode fetchAllPages} is the buffered
 * form: it collects every yielded page into one array.
 *
 * @module
 */

import * as v from "valibot";
import { parse } from "../../../../_base.ts";

/** Default for {@linkcode PaginationOptions.maxPages}. */
export const DEFAULT_MAX_PAGES = 100;

/**
 * Options for the paginated `*All` and `*Pages` info helpers.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#pagination
 */
export const PaginationOptions = /* @__PURE__ */ (() => {
  return v.object({
    /**
     * Maximum number of pages to fetch before giving up (a finite positive integer).
     *
     * Safety bound against a misbehaving server: every page is a separate request, so an endpoint
     * that never returns a short page would otherwise be re-requested forever.
     * @default 100
     */
    maxPages: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), DEFAULT_MAX_PAGES),
  });
})();
/** Options accepted by the paginated `*All` and `*Pages` Info API helpers. */
export type PaginationOptions = v.InferInput<typeof PaginationOptions>;

/**
 * Fetches a time-ranged endpoint page by page, yielding each page's new records in request order.
 *
 * The first request uses `startTime`; each full page is followed by a request whose `startTime`
 * is the page's newest timestamp — the maximum is taken, so the within-page order does not
 * matter. Because `startTime` is inclusive, the boundary millisecond is re-requested and the
 * records already yielded are dropped from the next page, matched by `keyOf` with multiset
 * semantics within the boundary cluster. This keeps a page capped mid-cluster correct: nothing
 * is skipped and nothing is duplicated, as long as `keyOf` identifies a record within a single
 * millisecond (see each helper for its endpoint's key).
 *
 * The generator ends when a page comes back empty or short (fewer than `pageLimit` elements), or
 * when it contributes nothing new: a page whose newest timestamp does not pass the running
 * watermark is dropped rather than yielded, so a server that ignores `startTime` and repeats a
 * page can neither cause duplicates nor an infinite loop.
 *
 * Nothing is requested until iteration starts: the generator is lazy, so breaking out of a
 * `for await` loop stops the walk without issuing further requests. Options are validated on the
 * first `next()` call, before the first request is made.
 *
 * @param fetchPage Issues one request for the given `startTime` and resolves with its page.
 * @param startTime Start time of the whole range (in ms since epoch).
 * @param pageLimit The endpoint's per-response cap; a page with fewer elements ends the range.
 * @param timeOf Reads an element's timestamp (in ms since epoch).
 * @param keyOf Reads an element's identity, unique within one millisecond (used to drop the
 *   inclusive-boundary overlap).
 * @param options Pagination options; validated before the first request is made.
 * @return An async generator yielding each fetched page's new records, without duplicates.
 *
 * @throws {ValidationError} When `options` fails validation (thrown by the first `next()` call,
 *   before any request is sent).
 */
export async function* fetchPages<T>(
  fetchPage: (startTime: number) => Promise<T[]>,
  startTime: number,
  pageLimit: number,
  timeOf: (item: T) => number,
  keyOf: (item: T) => string,
  options?: PaginationOptions,
): AsyncGenerator<T[], void, undefined> {
  const { maxPages } = parse(PaginationOptions, options ?? {});
  /** Newest timestamp yielded so far; `tail` holds the keys yielded at that millisecond. */
  let watermark = -Infinity;
  let tail = new Map<string, number>();
  let nextStartTime = startTime;
  for (let page = 0; page < maxPages; page++) {
    const items = await fetchPage(nextStartTime);
    if (items.length === 0) return; // range exhausted (or empty from the start)
    let pageMax = -Infinity;
    for (const item of items) {
      const time = timeOf(item);
      if (time > pageMax) pageMax = time;
    }
    // The page does not even reach what is already yielded: a repeat from a server ignoring
    // `startTime`. Drop it (yielding would duplicate it) and stop instead of re-requesting forever.
    if (pageMax < watermark) return;
    const advancing = pageMax > watermark;
    const fresh: T[] = [];
    for (const item of items) {
      const time = timeOf(item);
      if (time < watermark) continue; // stale repeat from a server ignoring startTime
      if (time === watermark) {
        const key = keyOf(item);
        const seen = tail.get(key) ?? 0;
        if (seen > 0) {
          tail.set(key, seen - 1); // inclusive-boundary overlap: already yielded
          continue;
        }
      }
      fresh.push(item);
    }
    if (!advancing && fresh.length === 0) return; // nothing new at the boundary: stop
    if (advancing) {
      watermark = pageMax;
      tail = new Map();
    }
    for (const item of fresh) {
      if (timeOf(item) === watermark) {
        const key = keyOf(item);
        tail.set(key, (tail.get(key) ?? 0) + 1);
      }
    }
    yield fresh;
    if (items.length < pageLimit) return; // short page: nothing more to fetch
    nextStartTime = watermark; // inclusive: re-requests the boundary, overlap dropped above
  }
}

/**
 * Fetches every page of a time-ranged endpoint and concatenates them in request order.
 *
 * Buffered form of {@linkcode fetchPages} — same walk, same boundary handling, but the caller
 * gets one array instead of a page stream. See {@linkcode fetchPages} for the pagination
 * contract.
 *
 * @param fetchPage Issues one request for the given `startTime` and resolves with its page.
 * @param startTime Start time of the whole range (in ms since epoch).
 * @param pageLimit The endpoint's per-response cap; a page with fewer elements ends the range.
 * @param timeOf Reads an element's timestamp (in ms since epoch).
 * @param keyOf Reads an element's identity, unique within one millisecond (used to drop the
 *   inclusive-boundary overlap).
 * @param options Pagination options; validated before the first request is made.
 * @return The concatenation of every fetched page, without duplicates.
 *
 * @throws {ValidationError} When `options` fails validation (before any request is sent).
 */
export async function fetchAllPages<T>(
  fetchPage: (startTime: number) => Promise<T[]>,
  startTime: number,
  pageLimit: number,
  timeOf: (item: T) => number,
  keyOf: (item: T) => string,
  options?: PaginationOptions,
): Promise<T[]> {
  return collectPages(fetchPages(fetchPage, startTime, pageLimit, timeOf, keyOf, options));
}

/**
 * Collects every page of a `*Pages` async generator into one array, in iteration order.
 *
 * @param pages The page stream to drain (e.g. the result of a `*Pages` helper).
 * @return The concatenation of every yielded page.
 */
export async function collectPages<T>(pages: AsyncIterable<T[]>): Promise<T[]> {
  const all: T[] = [];
  for await (const page of pages) {
    all.push(...page);
  }
  return all;
}
