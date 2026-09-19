/**
 * Offline tests for {@linkcode userTwapSliceFillsByTimePages} over a mock transport.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient } from "@bloxwap/hyperliquid";
import { userTwapSliceFillsByTimePages } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const USER = "0x0000000000000000000000000000000000000001";
const PAGE = 500; // documented cap for time-ranged responses

/** A page of TWAP slice fills; the timestamp and identity live on the nested `fill`. */
function sliceFillsPage(firstTime: number, count: number): { fill: { time: number; tid: number }; twapId: number }[] {
  return Array.from({ length: count }, (_, i) => ({ fill: { time: firstTime + i, tid: firstTime + i }, twapId: 1 }));
}

describe("userTwapSliceFillsByTimePages", () => {
  test("yields 2.5 pages keyed on the nested fill time and tid", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([sliceFillsPage(0, PAGE), sliceFillsPage(PAGE, PAGE), sliceFillsPage(2 * PAGE, 250)]),
    );

    const lengths: number[] = [];
    const tids: number[] = [];
    for await (const page of userTwapSliceFillsByTimePages({ transport }, { user: USER, startTime: 0 })) {
      lengths.push(page.length);
      tids.push(...page.map((sliceFill) => sliceFill.fill.tid));
    }

    expect(lengths).toEqual([PAGE, PAGE, 250]);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499, 999]);
    expect(new Set(tids).size).toBe(1_250); // no duplicates across pages
  });

  test("ends immediately when the first page is empty", async () => {
    const transport = new MockInfoTransport(scriptedPages([[]]));

    const pages = userTwapSliceFillsByTimePages({ transport }, { user: USER, startTime: 0 });

    const first = await pages.next();
    expect(first.done).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([sliceFillsPage(0, PAGE), sliceFillsPage(PAGE, 7)]));
    const client = new InfoClient({ transport });
    const signal = new AbortController().signal;

    const lengths: number[] = [];
    for await (const page of client.userTwapSliceFillsByTimePages(
      { user: USER, startTime: 0 },
      { maxPages: 5 },
      signal,
    )) {
      lengths.push(page.length);
    }

    expect(lengths).toEqual([PAGE, 7]);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499]);
    expect(transport.calls[0].signal).toBe(signal);
  });
});
