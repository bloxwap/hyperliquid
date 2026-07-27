/**
 * Offline tests for {@linkcode fundingHistoryAll} over a mock transport (500-record pages).
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { fundingHistoryAll } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const PAGE = 500; // fundingHistory returns at most 500 records per response

function fundingPage(firstTime: number, count: number): { coin: string; time: number }[] {
  return Array.from({ length: count }, (_, i) => ({ coin: "ETH", time: firstTime + i }));
}

describe("fundingHistoryAll", () => {
  test("concatenates 2.5 pages keyed on the record time", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([fundingPage(0, PAGE), fundingPage(PAGE, PAGE), fundingPage(2 * PAGE, 250)]),
    );

    const result = await fundingHistoryAll({ transport }, { coin: "ETH", startTime: 0 });

    expect(result).toHaveLength(1_250);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499, 999]);
    expect(result[1_249].time).toBe(1_249);
  });

  test("a 499-record page is short and stops the walk", async () => {
    const transport = new MockInfoTransport(scriptedPages([fundingPage(0, PAGE - 1)]));

    const result = await fundingHistoryAll({ transport }, { coin: "ETH", startTime: 0 });

    expect(result).toHaveLength(499);
    expect(transport.calls).toHaveLength(1);
  });

  test("forwards coin and endTime to every page request", async () => {
    const transport = new MockInfoTransport(scriptedPages([fundingPage(0, PAGE), fundingPage(PAGE, 1)]));

    await fundingHistoryAll({ transport }, { coin: "BTC", startTime: 0, endTime: 777 });

    for (const call of transport.calls) {
      const payload = call.payload as Record<string, unknown>;
      expect(payload.type).toBe("fundingHistory");
      expect(payload.coin).toBe("BTC");
      expect(payload.endTime).toBe(777);
    }
  });
});
