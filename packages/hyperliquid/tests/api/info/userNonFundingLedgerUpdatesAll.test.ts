/**
 * Offline tests for {@linkcode userNonFundingLedgerUpdatesAll} over a mock transport.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient } from "@bloxwap/hyperliquid";
import { userNonFundingLedgerUpdatesAll } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const USER = "0x0000000000000000000000000000000000000001";
const PAGE = 500; // documented cap for time-ranged responses

function ledgerPage(firstTime: number, count: number): { time: number }[] {
  return Array.from({ length: count }, (_, i) => ({ time: firstTime + i }));
}

describe("userNonFundingLedgerUpdatesAll", () => {
  test("concatenates 2.5 pages keyed on the update time", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([ledgerPage(0, PAGE), ledgerPage(PAGE, PAGE), ledgerPage(2 * PAGE, 250)]),
    );

    const result = await userNonFundingLedgerUpdatesAll({ transport }, { user: USER, startTime: 0 });

    expect(result).toHaveLength(1_250);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499, 999]);
  });

  test("stays correct when a full page is larger than the documented 500 (server serves 2000)", async () => {
    // The live endpoint has been observed returning 2000-element pages. A conservative page limit
    // must only ever cost one extra request, never drop data.
    const transport = new MockInfoTransport(scriptedPages([ledgerPage(0, 2_000), ledgerPage(2_000, 10)]));

    const result = await userNonFundingLedgerUpdatesAll({ transport }, { user: USER, startTime: 0 });

    expect(result).toHaveLength(2_010);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 1_999]);
  });

  test("respects maxPages", async () => {
    let firstTime = 0;
    const transport = new MockInfoTransport(() => {
      const page = ledgerPage(firstTime, PAGE);
      firstTime += PAGE;
      return page;
    });

    const result = await userNonFundingLedgerUpdatesAll({ transport }, { user: USER, startTime: 0 }, { maxPages: 2 });

    expect(result).toHaveLength(1_000);
    expect(transport.calls).toHaveLength(2);
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([ledgerPage(0, PAGE), ledgerPage(PAGE, 7)]));
    const client = new InfoClient({ transport });
    const signal = new AbortController().signal;

    const result = await client.userNonFundingLedgerUpdatesAll({ user: USER, startTime: 0 }, { maxPages: 5 }, signal);

    expect(result).toHaveLength(507);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499]);
    expect(transport.calls[0].signal).toBe(signal);
  });
});
