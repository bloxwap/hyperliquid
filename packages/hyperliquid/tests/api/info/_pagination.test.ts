import { expect, test } from "bun:test";
import { fetchPages } from "../../../src/api/info/_methods/_base/_pagination.ts";

test("boundary multiplicities survive partial overlap across several full pages", async () => {
  const old = { time: 0, key: "old" };
  const a = { time: 1, key: "a" };
  const b = { time: 1, key: "b" };
  const responses = [
    [old, a, a],
    [a, a, a], // one new occurrence, despite identical keys
    [a, a, b], // a partial overlap must not erase the three remembered occurrences of a
    [a, a, a], // all three occurrences were already yielded: stop here
  ];
  const starts: number[] = [];
  const yielded: (typeof responses)[number][] = [];
  for await (const page of fetchPages(
    async (start) => {
      starts.push(start);
      return responses[Math.min(starts.length - 1, responses.length - 1)];
    },
    0,
    3,
    (item) => item.time,
    (item) => item.key,
    { maxPages: 8 },
  )) {
    yielded.push(page);
  }

  expect(starts).toEqual([0, 1, 1, 1]);
  expect(yielded).toEqual([[old, a, a], [a], [b]]);
});
