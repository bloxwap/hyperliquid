/**
 * Tests for the token-bucket rate limiter: deduction from a full bucket, lazy
 * refill over time, FIFO waiting, and over-capacity acquisitions.
 * @module
 */

import { afterEach, beforeEach, describe, test } from "bun:test";
import { assert, assertEquals, assertThrows } from "@jsr/std__assert";
import { FakeTime } from "@jsr/std__testing/time";
import { TokenBucketRateLimiter } from "../../../src/transport/http/_rateLimiter.ts";

/** Waits until queued promise reactions have settled. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Tracks whether an acquisition has resolved. */
function track(promise: Promise<void>): { resolved: boolean } {
  const state = { resolved: false };
  promise.then(() => (state.resolved = true));
  return state;
}

describe("TokenBucketRateLimiter", () => {
  // The npm build of `@std/testing/time` drops the `[Symbol.dispose]` member the Deno version
  // declares, so the clock is installed and restored through hooks instead of a `using` binding.
  let time: FakeTime;

  beforeEach(() => {
    time = new FakeTime();
  });

  afterEach(() => {
    time.restore();
  });

  test("resolves without waiting while the bucket covers the weight", async () => {
    const bucket = new TokenBucketRateLimiter(2, 60);

    const first = track(bucket.acquire());
    const second = track(bucket.acquire());
    await flush();
    assert(first.resolved && second.resolved);

    // The bucket is now empty: the next acquisition must wait.
    const third = track(bucket.acquire());
    await flush();
    assertEquals(third.resolved, false);
  });

  test("defaults to a weight of 1 per acquisition", async () => {
    const bucket = new TokenBucketRateLimiter(3, 60);

    bucket.acquire(2); // 2 of 3 tokens
    const immediate = track(bucket.acquire()); // the last token
    const waiting = track(bucket.acquire()); // bucket empty
    await flush();
    assert(immediate.resolved);
    assertEquals(waiting.resolved, false);
  });

  test("refills at the configured per-minute rate", async () => {
    const bucket = new TokenBucketRateLimiter(1, 60); // 1 token per second

    bucket.acquire(); // empties the bucket
    const waiting = track(bucket.acquire());
    await flush();
    assertEquals(waiting.resolved, false);

    time.tick(999); // 1 ms short of the next token
    await flush();
    assertEquals(waiting.resolved, false);

    time.tick(1); // exactly one second: one token
    await flush();
    assert(waiting.resolved);
  });

  test("caps the refill at the capacity", async () => {
    const bucket = new TokenBucketRateLimiter(2, 1200); // 20 tokens per second

    bucket.acquire();
    bucket.acquire(); // bucket empty
    time.tick(10_000); // would earn 200 uncapped; the bucket holds at most 2
    await flush();

    const first = track(bucket.acquire());
    const second = track(bucket.acquire());
    const third = track(bucket.acquire());
    await flush();
    assert(first.resolved && second.resolved);
    assertEquals(third.resolved, false);
  });

  test("serves waiting acquisitions in arrival order", async () => {
    const bucket = new TokenBucketRateLimiter(1, 60); // 1 token per second

    bucket.acquire(); // empties the bucket
    const first = track(bucket.acquire());
    const second = track(bucket.acquire());
    await flush();

    time.tick(1_000); // one token: only the earlier waiter may proceed
    await flush();
    assert(first.resolved);
    assertEquals(second.resolved, false);

    time.tick(1_000);
    await flush();
    assert(second.resolved);
  });

  test("a small later request never overtakes a large earlier one", async () => {
    const bucket = new TokenBucketRateLimiter(5, 300); // 5 tokens per second

    bucket.acquire(5); // empties the bucket
    const large = track(bucket.acquire(4)); // needs 800 ms
    const small = track(bucket.acquire(1)); // could proceed after 200 ms on its own
    await flush();

    time.tick(600); // 3 tokens: enough for `small`, not for `large`
    await flush();
    assertEquals(large.resolved, false);
    assertEquals(small.resolved, false);

    time.tick(200); // 4 tokens: `large` proceeds, consuming all of them
    await flush();
    assert(large.resolved);
    assertEquals(small.resolved, false);

    time.tick(200); // 1 token: now `small`
    await flush();
    assert(small.resolved);
  });

  test("an over-capacity weight is served out of a full bucket and drives it into debt", async () => {
    const bucket = new TokenBucketRateLimiter(10, 600); // 10 tokens per second

    // 15 > capacity: the acquisition can only be served by the full bucket (10),
    // leaving a debt of 5 tokens.
    const large = track(bucket.acquire(15));
    await flush();
    assertEquals(large.resolved, false);

    time.tick(1); // the bucket was already full; the wake-up fires immediately
    await flush();
    assert(large.resolved);

    // The debt (5) plus the next request's weight (1) refills in 600 ms at 10 tokens/second.
    const next = track(bucket.acquire());
    await flush();
    assertEquals(next.resolved, false);

    time.tick(500); // 501 ms of the 600 ms the debt needs
    await flush();
    assertEquals(next.resolved, false);

    time.tick(200); // 701 ms: comfortably past the debt
    await flush();
    assert(next.resolved);
  });

  test("rejects a non-positive capacity or refill rate", () => {
    assertThrows(() => new TokenBucketRateLimiter(0, 60), RangeError);
    assertThrows(() => new TokenBucketRateLimiter(60, 0), RangeError);
    assertThrows(() => new TokenBucketRateLimiter(Number.NaN, 60), RangeError);
  });
});
