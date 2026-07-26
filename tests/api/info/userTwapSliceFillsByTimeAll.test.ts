/**
 * Offline tests for {@linkcode userTwapSliceFillsByTimeAll} over a mock transport.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { userTwapSliceFillsByTimeAll } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const USER = "0x0000000000000000000000000000000000000001";
const PAGE = 500; // documented cap for time-ranged responses

/** A page of TWAP slice fills; the timestamp and identity live on the nested `fill`. */
function sliceFillsPage(firstTime: number, count: number): { fill: { time: number; tid: number }; twapId: number }[] {
  return Array.from({ length: count }, (_, i) => ({ fill: { time: firstTime + i, tid: firstTime + i }, twapId: 1 }));
}

describe("userTwapSliceFillsByTimeAll", () => {
  test("concatenates 2.5 pages keyed on the nested fill time", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([sliceFillsPage(0, PAGE), sliceFillsPage(PAGE, PAGE), sliceFillsPage(2 * PAGE, 250)]),
    );

    const result = await userTwapSliceFillsByTimeAll({ transport }, { user: USER, startTime: 0 });

    expect(result).toHaveLength(1_250);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499, 999]);
    expect(result[1_249].fill.time).toBe(1_249);
    expect(result[1_249].twapId).toBe(1);
  });

  test("returns an empty array when the first page is empty", async () => {
    const transport = new MockInfoTransport(scriptedPages([[]]));

    const result = await userTwapSliceFillsByTimeAll({ transport }, { user: USER, startTime: 0 });

    expect(result).toEqual([]);
    expect(transport.calls).toHaveLength(1);
  });
});
