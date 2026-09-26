/**
 * Offline tests for {@linkcode candleSnapshotPages} over a mock transport.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient } from "@bloxwap/hyperliquid";
import { candleSnapshotPages } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const PAGE = 5000; // the server serves at most ~5000 candles (its availability window) per response

/** A page of candles keyed on the opening timestamp `t`. */
function candlePage(firstTime: number, count: number): { t: number }[] {
  return Array.from({ length: count }, (_, i) => ({ t: firstTime + i * 60_000 }));
}

/** Reads the `startTime` of every recorded request payload (nested under `req`). */
function requestedStartTimes(transport: MockInfoTransport): number[] {
  return transport.calls.map((c) => (c.payload as { req: { startTime: number } }).req.startTime);
}

describe("candleSnapshotPages", () => {
  test("yields each page as it arrives and stops at the short page", async () => {
    const transport = new MockInfoTransport(scriptedPages([candlePage(0, PAGE), candlePage(PAGE * 60_000, 120)]));

    const lengths: number[] = [];
    for await (const page of candleSnapshotPages(
      { transport },
      { coin: "ETH", interval: "1m", startTime: 0, endTime: 999_999_999 },
    )) {
      lengths.push(page.length);
    }

    expect(lengths).toEqual([PAGE, 120]);
    expect(requestedStartTimes(transport)).toEqual([0, (PAGE - 1) * 60_000]); // startTime is inclusive
  });

  test("drops the repeated availability window instead of looping forever", async () => {
    const transport = new MockInfoTransport(() => candlePage(0, PAGE)); // same window forever

    const lengths: number[] = [];
    for await (const page of candleSnapshotPages({ transport }, { coin: "ETH", interval: "1m", startTime: 0 })) {
      lengths.push(page.length);
    }

    expect(lengths).toEqual([PAGE]);
    expect(transport.calls).toHaveLength(2);
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([candlePage(0, PAGE), candlePage(PAGE * 60_000, 7)]));
    const client = new InfoClient({ transport });
    const signal = new AbortController().signal;

    const lengths: number[] = [];
    for await (const page of client.candleSnapshotPages(
      { coin: "ETH", interval: "1m", startTime: 0 },
      { maxPages: 5 },
      signal,
    )) {
      lengths.push(page.length);
    }

    expect(lengths).toEqual([PAGE, 7]);
    expect(requestedStartTimes(transport)).toEqual([0, (PAGE - 1) * 60_000]);
    expect(transport.calls[0].signal).toBe(signal);
  });
});
