/**
 * Offline tests for {@linkcode userFillsByTimePages} over a mock transport.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient, ValidationError } from "@bloxwap/hyperliquid";
import { userFillsByTimePages } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const USER = "0x0000000000000000000000000000000000000001";
const PAGE = 2000; // userFillsByTime returns at most 2000 fills per response

/** A page of `count` fills with timestamps `firstTime .. firstTime + count - 1`, shuffled. */
function fillsPage(firstTime: number, count: number, firstTid = 1): { time: number; tid: number }[] {
  // Descending within the page on purpose: the walk must key on the max timestamp, not the last element.
  return Array.from({ length: count }, (_, i) => ({ time: firstTime + count - 1 - i, tid: firstTid + i }));
}

describe("userFillsByTimePages", () => {
  test("a page capped mid-cluster neither skips nor duplicates the same-millisecond overlap", async () => {
    // The full dataset: times 1000..2997 (1998 fills) plus a 5-fill cluster at 2999 (2003 total).
    const cluster = [2_999, 2_999, 2_999, 2_999, 2_999].map((time, i) => ({ time, tid: 1_999 + i }));
    const page1 = [...fillsPage(1_000, 1_998), ...cluster.slice(0, 2)]; // capped at 2000, mid-cluster
    const page2 = cluster; // the server's inclusive answer for startTime = 2999
    const transport = new MockInfoTransport(scriptedPages([page1, page2]));

    const tids: number[] = [];
    for await (const page of userFillsByTimePages({ transport }, { user: USER, startTime: 1_000 })) {
      tids.push(...page.map((f) => f.tid));
    }

    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([1_000, 2_999]);
    expect(tids.sort((a, b) => a - b)).toEqual(Array.from({ length: 2_003 }, (_, i) => i + 1)); // every tid once
  });

  test("rejects reversed: true before any request", () => {
    const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, 1)]));
    const params = { user: USER, startTime: 1_000, reversed: true } as never; // untyped caller

    // Validation throws synchronously, the same way request-schema validation does in every method.
    expect(() => userFillsByTimePages({ transport }, params)).toThrow(ValidationError);
    expect(() => userFillsByTimePages({ transport }, params)).toThrow(/reversed/);
    expect(transport.calls).toHaveLength(0);
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, PAGE), fillsPage(3_000, 7)]));
    const client = new InfoClient({ transport });

    const lengths: number[] = [];
    for await (const page of client.userFillsByTimePages({ user: USER, startTime: 1_000 }, { maxPages: 5 })) {
      lengths.push(page.length);
    }

    expect(lengths).toEqual([PAGE, 7]);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([1_000, 2_999]);
  });
});
