/**
 * Tests for the token-bucket rate limiter: deduction from a full bucket, lazy
 * refill over time, FIFO waiting, and over-capacity acquisitions.
 * @module
 */

import { afterEach, beforeEach, describe, test } from "bun:test";
import { assert, assertEquals, assertRejects, assertThrows } from "@jsr/std__assert";
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

    const first = track(bucket.acquire(1));
    const second = track(bucket.acquire(1));
    await flush();
    assert(first.resolved && second.resolved);

    // The bucket is now empty: the next acquisition must wait.
    const third = track(bucket.acquire(1));
    await flush();
    assertEquals(third.resolved, false);
  });

  test("defaults to a weight of 1 per acquisition", async () => {
    const bucket = new TokenBucketRateLimiter(3, 60);

    bucket.acquire(2); // 2 of 3 tokens
    const immediate = track(bucket.acquire(1)); // the last token
    const waiting = track(bucket.acquire(1)); // bucket empty
    await flush();
    assert(immediate.resolved);
    assertEquals(waiting.resolved, false);
  });

  test("refills at the configured per-minute rate", async () => {
    const bucket = new TokenBucketRateLimiter(1, 60); // 1 token per second

    bucket.acquire(1); // empties the bucket
    const waiting = track(bucket.acquire(1));
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

    bucket.acquire(1);
    bucket.acquire(1); // bucket empty
    time.tick(10_000); // would earn 200 uncapped; the bucket holds at most 2
    await flush();

    const first = track(bucket.acquire(1));
    const second = track(bucket.acquire(1));
    const third = track(bucket.acquire(1));
    await flush();
    assert(first.resolved && second.resolved);
    assertEquals(third.resolved, false);
  });

  test("serves waiting acquisitions in arrival order", async () => {
    const bucket = new TokenBucketRateLimiter(1, 60); // 1 token per second

    bucket.acquire(1); // empties the bucket
    const first = track(bucket.acquire(1));
    const second = track(bucket.acquire(1));
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
    const next = track(bucket.acquire(1));
    await flush();
    assertEquals(next.resolved, false);

    time.tick(500); // 501 ms of the 600 ms the debt needs
    await flush();
    assertEquals(next.resolved, false);

    time.tick(200); // 701 ms: comfortably past the debt
    await flush();
    assert(next.resolved);
  });

  test("an already-aborted signal rejects without spending tokens", async () => {
    const bucket = new TokenBucketRateLimiter(1, 60);
    const reason = new Error("aborted");

    await assertRejects(() => bucket.acquire(1, AbortSignal.abort(reason)), Error, "aborted");

    // The bucket is still full: an unaborted acquisition resolves without waiting.
    const immediate = track(bucket.acquire(1));
    await flush();
    assert(immediate.resolved);
  });

  test("aborting a queued acquisition removes it without spending tokens", async () => {
    const bucket = new TokenBucketRateLimiter(1, 60); // 1 token per second
    bucket.acquire(1); // empties the bucket

    const controller = new AbortController();
    const waiting = bucket.acquire(1, controller.signal);
    controller.abort(new Error("cancelled"));
    await assertRejects(() => waiting, Error, "cancelled");

    // Nothing was consumed: the next acquisition is served on the normal refill cadence.
    const next = track(bucket.acquire(1));
    await flush();
    assertEquals(next.resolved, false);

    time.tick(1_000);
    await flush();
    assert(next.resolved);
  });

  test("schedules year-scale waits in bounded slices and serves at the real due time", async () => {
    // 1 token per 60_000_000_000 ms: the wake-up for the next token is ~1.9 years out, far
    // beyond the 2^31-1 ms a single setTimeout can express without clamping to ~1 ms.
    const bucket = new TokenBucketRateLimiter(1, 1e-6);
    bucket.acquire(1); // consumes the only token
    const start = time.now;

    const waiting = track(bucket.acquire(1));
    await flush();
    assertEquals(waiting.resolved, false);

    // Advance wake-up to wake-up: each must be one bounded slice, and the total advance must
    // reach the real due time — not a clamped early one, and never a spin.
    let advances = 0;
    while (!waiting.resolved) {
      assert(time.next(), "a wake-up must always be armed while a waiter is pending");
      advances++;
      assert(advances <= 100, "the scheduler must not spin: at most a handful of slices per wait");
      await flush();
    }
    assert(advances > 1, "a year-scale wait must be sliced, not scheduled as one overflowing timer");

    const expected = Math.ceil(1 / (1e-6 / 60_000)); // the same arithmetic the bucket performs
    const elapsed = time.now - start;
    assert(Math.abs(elapsed - expected) <= 1, `served after ${elapsed} ms, expected ~${expected}`);
  });

  test("abort removes waiters at middle and tail; survivors keep FIFO order", async () => {
    const bucket = new TokenBucketRateLimiter(1, 60); // 1 token per second
    bucket.acquire(1); // empties the bucket

    const order: string[] = [];
    const named = (name: string, signal?: AbortSignal): void => {
      bucket.acquire(1, signal).then(
        () => order.push(name),
        () => order.push(`rejected:${name}`),
      );
    };

    const middle = new AbortController();
    const tail = new AbortController();
    named("first");
    named("middle", middle.signal); // due at 2 s
    named("last", tail.signal); // due at 3 s
    await flush();

    // Drop the middle: the head's wake-up is untouched, the tail moves up one slot.
    middle.abort(new Error("drop middle"));
    time.tick(1_000);
    await flush();
    assertEquals(order, ["rejected:middle", "first"]);

    // Drop the tail (now also the head): the queue empties without serving it.
    tail.abort(new Error("drop tail"));
    time.tick(5_000);
    await flush();
    assertEquals(order, ["rejected:middle", "first", "rejected:last"]);

    // The bucket still works: a fresh acquisition is served one refill later.
    named("after");
    time.tick(1_000);
    await flush();
    assertEquals(order, ["rejected:middle", "first", "rejected:last", "after"]);
  });

  test("aborting the head re-times the wake-up for the next waiter", async () => {
    const bucket = new TokenBucketRateLimiter(5, 300); // 5 tokens per second
    bucket.acquire(5); // empties the bucket

    const controller = new AbortController();
    const large = bucket.acquire(4, controller.signal); // head: would wake at 800 ms
    const small = track(bucket.acquire(1)); // queued behind it

    controller.abort(new Error("skip"));
    await assertRejects(() => large, Error, "skip");

    // `small` becomes the head and goes at 200 ms, not at the stale 800 ms wake-up.
    time.tick(200);
    await flush();
    assert(small.resolved);
  });

  test("charge debits tokens without waiting, driving the bucket into debt", async () => {
    const bucket = new TokenBucketRateLimiter(5, 300); // 5 tokens per second

    bucket.acquire(3); // 2 tokens left
    bucket.charge(4); // post-hoc debit: -2 tokens of debt

    const next = track(bucket.acquire(1)); // needs 3 tokens: 600 ms
    await flush();
    assertEquals(next.resolved, false);

    time.tick(599);
    await flush();
    assertEquals(next.resolved, false);

    time.tick(1);
    await flush();
    assert(next.resolved);
  });

  test("rejects non-positive, non-finite, or underflowing configuration", () => {
    // Zero and negatives would stall the queue forever.
    assertThrows(() => new TokenBucketRateLimiter(0, 60), RangeError, "capacity=0");
    assertThrows(() => new TokenBucketRateLimiter(60, 0), RangeError, "refillPerMinute=0");
    assertThrows(() => new TokenBucketRateLimiter(-1, 60), RangeError, "capacity=-1");
    assertThrows(() => new TokenBucketRateLimiter(60, -1), RangeError, "refillPerMinute=-1");
    // NaN and Infinity break the token arithmetic.
    assertThrows(() => new TokenBucketRateLimiter(Number.NaN, 60), RangeError, "capacity=NaN");
    assertThrows(() => new TokenBucketRateLimiter(60, Number.NaN), RangeError, "refillPerMinute=NaN");
    assertThrows(() => new TokenBucketRateLimiter(Number.POSITIVE_INFINITY, 60), RangeError, "capacity=Infinity");
    assertThrows(
      () => new TokenBucketRateLimiter(60, Number.POSITIVE_INFINITY),
      RangeError,
      "refillPerMinute=Infinity",
    );
    // The derived per-ms refill underflows to zero: a queued acquire would wait forever.
    assertThrows(() => new TokenBucketRateLimiter(1, Number.MIN_VALUE), RangeError, "refillPerMinute=5e-324");
  });

  test("accepts the smallest refill that still yields a nonzero per-ms rate", async () => {
    // 60_000 * MIN_VALUE is about the smallest refillPerMinute whose refillPerMs stays nonzero.
    const bucket = new TokenBucketRateLimiter(1, 60_000 * Number.MIN_VALUE);

    const immediate = track(bucket.acquire(1));
    await flush();
    assert(immediate.resolved);
  });
});
