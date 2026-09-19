/**
 * Offline tests for {@linkcode userNonFundingLedgerUpdatesPages} over a mock transport.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient } from "@bloxwap/hyperliquid";
import { userNonFundingLedgerUpdatesPages } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const USER = "0x0000000000000000000000000000000000000001";
const PAGE = 500; // documented cap for time-ranged responses

/** A page of ledger updates; the boundary key is `hash:time`. */
function ledgerPage(firstTime: number, count: number): { hash: string; time: number }[] {
  return Array.from({ length: count }, (_, i) => ({ hash: `0x${firstTime + i}`, time: firstTime + i }));
}

describe("userNonFundingLedgerUpdatesPages", () => {
  test("yields 2.5 pages keyed on the update hash and time", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([ledgerPage(0, PAGE), ledgerPage(PAGE, PAGE), ledgerPage(2 * PAGE, 250)]),
    );

    const lengths: number[] = [];
    const seen = new Set<string>();
    for await (const page of userNonFundingLedgerUpdatesPages({ transport }, { user: USER, startTime: 0 })) {
      lengths.push(page.length);
      for (const update of page) {
        const key = `${update.hash}:${update.time}`;
        expect(seen.has(key)).toBe(false); // no duplicates across pages
        seen.add(key);
      }
    }

    expect(lengths).toEqual([PAGE, PAGE, 250]);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499, 999]);
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([ledgerPage(0, PAGE), ledgerPage(PAGE, 7)]));
    const client = new InfoClient({ transport });
    const signal = new AbortController().signal;

    const lengths: number[] = [];
    for await (const page of client.userNonFundingLedgerUpdatesPages(
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
