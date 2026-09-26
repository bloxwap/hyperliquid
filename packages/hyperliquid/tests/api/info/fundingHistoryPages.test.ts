/**
 * Offline tests for {@linkcode fundingHistoryPages} over a mock transport (500-record pages).
 *
 * The streaming walk is exercised most thoroughly here: laziness, page-at-a-time yields, early
 * termination by the consumer, option validation timing, and the InfoClient wrapper. The other
 * `*Pages` helpers share the same generator and are covered by their own files.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient, ValidationError } from "@bloxwap/hyperliquid";
import { fundingHistoryPages } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport, scriptedPages } from "./_mockInfoTransport.ts";

const PAGE = 500; // fundingHistory returns at most 500 records per response

function fundingPage(firstTime: number, count: number): { coin: string; time: number }[] {
  return Array.from({ length: count }, (_, i) => ({ coin: "ETH", time: firstTime + i }));
}

/** Drains a page stream into one array. */
async function drain<T>(pages: AsyncIterable<T[]>): Promise<T[]> {
  const all: T[] = [];
  for await (const page of pages) all.push(...page);
  return all;
}

describe("fundingHistoryPages", () => {
  test("issues no request until the first next() call", async () => {
    const transport = new MockInfoTransport(scriptedPages([fundingPage(0, 1)]));

    const pages = fundingHistoryPages({ transport }, { coin: "ETH", startTime: 0 });
    expect(transport.calls).toHaveLength(0);

    await pages.next();
    expect(transport.calls).toHaveLength(1);
  });

  test("yields 2.5 pages one fetch at a time, then ends", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([fundingPage(0, PAGE), fundingPage(PAGE, PAGE), fundingPage(2 * PAGE, 250)]),
    );

    const pages = fundingHistoryPages({ transport }, { coin: "ETH", startTime: 0 });

    const page1 = await pages.next();
    expect(page1.done).toBe(false);
    expect(page1.value).toHaveLength(PAGE);
    expect(transport.calls).toHaveLength(1); // the next page is not requested until asked for

    const page2 = await pages.next();
    expect(page2.done).toBe(false);
    if (page2.done) return; // narrow the yield type for the index below
    expect(page2.value).toHaveLength(PAGE);
    expect(page2.value[0].time).toBe(PAGE); // the inclusive boundary overlap (time 499) is dropped
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499]);

    const page3 = await pages.next();
    expect(page3.value).toHaveLength(250);

    const end = await pages.next();
    expect(end.done).toBe(true);
    expect(transport.calls).toHaveLength(3); // the short page ends the walk
  });

  test("drained pages concatenate to the same result as fundingHistoryAll", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([fundingPage(0, PAGE), fundingPage(PAGE, PAGE), fundingPage(2 * PAGE, 250)]),
    );

    const result = await drain(fundingHistoryPages({ transport }, { coin: "ETH", startTime: 0 }));

    expect(result).toHaveLength(1_250);
    expect(result[1_249].time).toBe(1_249);
  });

  test("breaking out of the loop stops the walk without further requests", async () => {
    const transport = new MockInfoTransport(
      scriptedPages([fundingPage(0, PAGE), fundingPage(PAGE, PAGE), fundingPage(2 * PAGE, PAGE)]),
    );

    for await (const page of fundingHistoryPages({ transport }, { coin: "ETH", startTime: 0 })) {
      expect(page).toHaveLength(PAGE);
      break; // the consumer is done after one page
    }

    expect(transport.calls).toHaveLength(1);
  });

  test("ends immediately when the first page is empty", async () => {
    const transport = new MockInfoTransport(scriptedPages([[]]));

    const pages = fundingHistoryPages({ transport }, { coin: "ETH", startTime: 0 });

    const first = await pages.next();
    expect(first.done).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });

  test("drops a repeated page and ends instead of looping forever", async () => {
    const transport = new MockInfoTransport(() => fundingPage(0, PAGE)); // same window forever

    const yielded: number[] = [];
    for await (const page of fundingHistoryPages({ transport }, { coin: "ETH", startTime: 0 })) {
      yielded.push(page.length);
    }

    expect(yielded).toEqual([PAGE]); // the repeat is dropped, not yielded
    expect(transport.calls).toHaveLength(2);
  });

  test("rejects invalid maxPages on the first next() call, before any request", async () => {
    for (const maxPages of [0, -1, NaN, Infinity, 1.5]) {
      const transport = new MockInfoTransport(scriptedPages([fundingPage(0, 1)]));

      const pages = fundingHistoryPages({ transport }, { coin: "ETH", startTime: 0 }, { maxPages });

      await expect(pages.next()).rejects.toThrow(ValidationError);
      expect(transport.calls).toHaveLength(0); // validation happens before the first request
    }
  });

  test("is exposed on InfoClient with identical behavior", async () => {
    const transport = new MockInfoTransport(scriptedPages([fundingPage(0, PAGE), fundingPage(PAGE, 7)]));
    const client = new InfoClient({ transport });
    const signal = new AbortController().signal;

    const pages = client.fundingHistoryPages({ coin: "ETH", startTime: 0 }, { maxPages: 5 }, signal);

    const lengths: number[] = [];
    for await (const page of pages) lengths.push(page.length);

    expect(lengths).toEqual([PAGE, 7]);
    expect(transport.calls.map((c) => (c.payload as { startTime: number }).startTime)).toEqual([0, 499]);
    expect(transport.calls[0].signal).toBe(signal);
  });
});
