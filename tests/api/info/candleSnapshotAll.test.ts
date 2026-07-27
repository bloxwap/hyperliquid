/**
 * Offline tests for {@linkcode candleSnapshotAll} over a mock transport.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient } from "@bloxwap/hyperliquid";
import { candleSnapshotAll } from "@bloxwap/hyperliquid/api/info";
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

describe("candleSnapshotAll", () => {
  test("advances startTime past a full page's last opening time and stops at the short page", async () => {
    const transport = new MockInfoTransport(scriptedPages([candlePage(0, PAGE), candlePage(PAGE * 60_000, 120)]));

    const result = await candleSnapshotAll(
      { transport },
      { coin: "ETH", interval: "1m", startTime: 0, endTime: 999_999_999 },
    );

    expect(result).toHaveLength(5_120);
    expect(requestedStartTimes(transport)).toEqual([0, (PAGE - 1) * 60_000]); // startTime is inclusive
  });

  test("a single request is enough when the whole range fits one page", async () => {
    const transport = new MockInfoTransport(scriptedPages([candlePage(0, 1_440)]));

    const result = await candleSnapshotAll({ transport }, { coin: "ETH", interval: "1m", startTime: 0 });

    expect(result).toHaveLength(1_440);
    expect(transport.calls).toHaveLength(1);
    const payload = transport.calls[0].payload as { type: string; req: Record<string, unknown> };
    expect(payload.type).toBe("candleSnapshot");
    expect(payload.req).toEqual({ coin: "ETH", interval: "1m", startTime: 0 });
  });

  test("does not duplicate or loop forever when the server repeats its availability window", async () => {
    const transport = new MockInfoTransport(() => candlePage(0, PAGE)); // same window forever

    const result = await candleSnapshotAll({ transport }, { coin: "ETH", interval: "1m", startTime: 0 });

    // The repeated window reaches no new timestamp: it is dropped (not appended) and the walk stops.
    expect(transport.calls).toHaveLength(2);
    expect(result).toHaveLength(PAGE);
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([candlePage(0, PAGE), candlePage(PAGE * 60_000, 7)]));
    const client = new InfoClient({ transport });
    const signal = new AbortController().signal;

    const result = await client.candleSnapshotAll(
      { coin: "ETH", interval: "1m", startTime: 0 },
      { maxPages: 5 },
      signal,
    );

    expect(result).toHaveLength(5_007);
    expect(requestedStartTimes(transport)).toEqual([0, (PAGE - 1) * 60_000]);
    expect(transport.calls[0].signal).toBe(signal);
  });
});
