/**
 * Offline tests for {@linkcode userFillsByTimeAll} over a mock transport.
 *
 * Covers the full pagination matrix: multi-page concatenation with inclusive `startTime`
 * boundaries, the exact-page boundary, an empty first page, same-millisecond overlap dedupe, the
 * `maxPages` safety bound and its validation, `reversed` rejection, and a misbehaving server that
 * never advances timestamps. The other `*All` helpers share the same loop and are covered by
 * their own files.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient, ValidationError } from "@bloxwap/hyperliquid";
import { userFillsByTimeAll } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const USER = "0x0000000000000000000000000000000000000001";
const PAGE = 2000; // userFillsByTime returns at most 2000 fills per response

/** A page of `count` fills with timestamps `firstTime .. firstTime + count - 1`, shuffled. */
function fillsPage(firstTime: number, count: number, firstTid = 1): { time: number; tid: number }[] {
  // Descending within the page on purpose: the walk must key on the max timestamp, not the last element.
  return Array.from({ length: count }, (_, i) => ({ time: firstTime + count - 1 - i, tid: firstTid + i }));
}

/** Reads the `startTime` of every recorded request payload. */
function requestedStartTimes(transport: MockInfoTransport): number[] {
  return transport.calls.map((c) => (c.payload as { startTime: number }).startTime);
}

describe("userFillsByTimeAll", () => {
  test("concatenates 2.5 pages, re-requesting each page's newest timestamp (inclusive)", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([
        fillsPage(1_000, PAGE), // full page, times 1000..2999
        fillsPage(3_000, PAGE), // full page, times 3000..4999
        fillsPage(5_000, 1_000), // short page: stops the walk
      ]),
    );

    const result = await userFillsByTimeAll({ transport }, { user: USER, startTime: 1_000 });

    expect(result).toHaveLength(5_000);
    // startTime is inclusive: the next page starts AT the previous page's newest timestamp
    expect(requestedStartTimes(transport)).toEqual([1_000, 2_999, 4_999]);
    // Pages are concatenated in request order
    expect(result[0].time).toBe(2_999);
    expect(result[PAGE].time).toBe(4_999);
    expect(result[4_999].time).toBe(5_000);
  });

  test("stops at an empty page when the total is an exact multiple of the page size", async () => {
    const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, PAGE), fillsPage(3_000, PAGE)]));

    const result = await userFillsByTimeAll({ transport }, { user: USER, startTime: 1_000 });

    expect(result).toHaveLength(4_000);
    // Two full pages alone cannot prove exhaustion: one more request must confirm it
    expect(requestedStartTimes(transport)).toEqual([1_000, 2_999, 4_999]);
  });

  test("returns an empty array when the first page is empty", async () => {
    const transport = new MockInfoTransport(scriptedPages([[]]));

    const result = await userFillsByTimeAll({ transport }, { user: USER, startTime: 1_000 });

    expect(result).toEqual([]);
    expect(transport.calls).toHaveLength(1);
  });

  test("a page capped mid-cluster neither skips nor duplicates the same-millisecond overlap", async () => {
    // The full dataset: times 1000..2997 (1998 fills) plus a 5-fill cluster at 2999 (2003 total).
    const cluster = [2_999, 2_999, 2_999, 2_999, 2_999].map((time, i) => ({ time, tid: 1_999 + i }));
    const page1 = [...fillsPage(1_000, 1_998), ...cluster.slice(0, 2)]; // capped at 2000, mid-cluster
    const page2 = cluster; // the server's inclusive answer for startTime = 2999
    const transport = new MockInfoTransport(scriptedPages([page1, page2]));

    const result = await userFillsByTimeAll({ transport }, { user: USER, startTime: 1_000 });

    expect(requestedStartTimes(transport)).toEqual([1_000, 2_999]);
    expect(result).toHaveLength(2_003);
    const tids = result.map((f) => f.tid).sort((a, b) => a - b);
    expect(tids).toEqual(Array.from({ length: 2_003 }, (_, i) => i + 1)); // every tid exactly once
  });

  test("respects maxPages when the server always has more data", async () => {
    let firstTime = 1_000;
    const transport = new MockInfoTransport(() => {
      const page = fillsPage(firstTime, PAGE, firstTime);
      firstTime += PAGE; // always a full, advancing page (unique tids per page)
      return page;
    });

    const result = await userFillsByTimeAll({ transport }, { user: USER, startTime: 1_000 }, { maxPages: 3 });

    expect(result).toHaveLength(3 * PAGE);
    expect(requestedStartTimes(transport)).toEqual([1_000, 2_999, 4_999]);
  });

  test("does not duplicate or loop forever on a server that repeats the last page", async () => {
    const transport = new MockInfoTransport(() => fillsPage(1_000, PAGE)); // same page forever

    const result = await userFillsByTimeAll({ transport }, { user: USER, startTime: 1_000 });

    // The repeated page reaches no new timestamp: it is dropped (not appended) and the walk stops.
    expect(transport.calls).toHaveLength(2);
    expect(result).toHaveLength(PAGE);
    expect(new Set(result.map((f) => f.tid)).size).toBe(PAGE);
  });

  test("rejects invalid maxPages before any request", async () => {
    for (const maxPages of [0, -1, NaN, Infinity, 1.5]) {
      const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, 1)]));

      const promise = userFillsByTimeAll({ transport }, { user: USER, startTime: 1_000 }, { maxPages });

      await expect(promise).rejects.toThrow(ValidationError);
      expect(transport.calls).toHaveLength(0); // validation happens before the first request
    }
  });

  test("rejects reversed: true before any request", async () => {
    const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, 1)]));
    const params = { user: USER, startTime: 1_000, reversed: true } as never; // untyped caller

    // Validation throws synchronously, the same way request-schema validation does in every method.
    expect(() => userFillsByTimeAll({ transport }, params)).toThrow(ValidationError);
    expect(() => userFillsByTimeAll({ transport }, params)).toThrow(/reversed/);
    expect(transport.calls).toHaveLength(0);
  });

  test("accepts reversed: false and forwards endTime and aggregateByTime to every page request", async () => {
    const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, PAGE), fillsPage(3_000, 1)]));

    await userFillsByTimeAll(
      { transport },
      { user: USER, startTime: 1_000, endTime: 99_999, aggregateByTime: true, reversed: false },
    );

    for (const call of transport.calls) {
      const payload = call.payload as Record<string, unknown>;
      expect(payload.type).toBe("userFillsByTime");
      expect(payload.user).toBe(USER);
      expect(payload.endTime).toBe(99_999);
      expect(payload.aggregateByTime).toBe(true);
      expect(payload.reversed).toBe(false);
    }
  });

  test("accepts a string startTime (valibot input type) and pages numerically", async () => {
    const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, PAGE), fillsPage(3_000, 1)]));

    const result = await userFillsByTimeAll({ transport }, { user: USER, startTime: "1000" });

    expect(result).toHaveLength(2_001);
    expect(requestedStartTimes(transport)).toEqual([1_000, 2_999]);
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([fillsPage(1_000, PAGE), fillsPage(3_000, 7)]));
    const client = new InfoClient({ transport });

    const result = await client.userFillsByTimeAll({ user: USER, startTime: 1_000 }, { maxPages: 5 });

    expect(result).toHaveLength(2_007);
    expect(requestedStartTimes(transport)).toEqual([1_000, 2_999]);
  });
});
