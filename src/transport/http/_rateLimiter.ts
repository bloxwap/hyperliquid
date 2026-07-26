/**
 * Token-bucket rate limiter for the HTTP transport.
 *
 * Hyperliquid budgets REST requests at 1200 weight per minute per IP; exceeding it yields
 * HTTP 429 and ultimately an IP ban. An opt-in instance of this bucket on {@linkcode HttpTransport}
 * paces outgoing requests: each request acquires its weight before sending and WAITS (instead of
 * throwing) until the bucket has refilled enough to cover it.
 * @module
 */

import { Promise_ } from "../_polyfills.ts";

/** A queued acquisition waiting for enough tokens to accumulate. */
interface Waiter {
  /** Tokens this acquisition needs before it may proceed. */
  weight: number;
  /** Settles the acquisition once its tokens are deducted. */
  resolve: () => void;
}

/**
 * Token bucket with async FIFO waiting, paced to a weight-per-minute budget.
 *
 * The bucket starts full and refills continuously; accounting is lazy, computed from the clock
 * only when an acquisition or wake-up touches it, so an idle bucket costs nothing. Acquisitions
 * are served strictly in arrival order — a small later request never overtakes a large earlier
 * one — and a weight larger than the capacity is served out of a full bucket, driving the token
 * count into debt that later acquisitions wait off.
 */
export class TokenBucketRateLimiter {
  /** Tokens currently available; negative while paying off an over-capacity acquisition. */
  private _tokens: number;
  /** Clock reading at the last refill accounting. */
  private _lastRefill: number;
  /** Maximum tokens the bucket can hold. */
  private readonly _capacity: number;
  /** Tokens refilled per millisecond. */
  private readonly _refillPerMs: number;
  /** Pending acquisitions, in arrival order. */
  private _waiters: Waiter[] = [];
  /** Wake-up timer for the head waiter; at most one is armed at a time. */
  private _timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Creates a token bucket.
   *
   * @param capacity Maximum burst size, in weight units. The bucket starts full.
   * @param refillPerMinute Steady-state refill rate, in weight units per minute.
   */
  constructor(capacity: number, refillPerMinute: number) {
    // `!(x > 0)` rejects zero, negatives, and NaN alike — any of them would stall the queue forever.
    if (!(capacity > 0) || !(refillPerMinute > 0)) {
      throw new RangeError("TokenBucketRateLimiter: capacity and refillPerMinute must be positive numbers");
    }
    this._capacity = capacity;
    this._refillPerMs = refillPerMinute / 60_000;
    this._tokens = capacity;
    this._lastRefill = Date.now();
  }

  /**
   * Deducts `weight` tokens (default 1), resolving immediately when the bucket covers the cost
   * and otherwise waiting until the refill rate has accumulated them.
   */
  acquire(weight = 1): Promise<void> {
    // Fast path: nobody is waiting and the bucket covers the cost, so the deduction is all
    // the work there is.
    if (this._waiters.length === 0) {
      this._refill();
      if (this._tokens >= weight) {
        this._tokens -= weight;
        return Promise.resolve();
      }
    }
    const { promise, resolve } = Promise_.withResolvers<void>();
    this._waiters.push({ weight, resolve });
    this._schedule();
    return promise;
  }

  /** Accrues the tokens earned since the last accounting, capped at the capacity. */
  private _refill(): void {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    if (elapsed <= 0) return;
    this._tokens = Math.min(this._capacity, this._tokens + elapsed * this._refillPerMs);
    this._lastRefill = now;
  }

  /** Arms the wake-up timer for the head waiter, unless one is already armed. */
  private _schedule(): void {
    if (this._timer !== undefined) return;
    this._refill();
    const deficit = this._needed(this._waiters[0]) - this._tokens;
    const waitMs = Math.max(0, Math.ceil(deficit / this._refillPerMs));
    this._timer = setTimeout(() => {
      this._timer = undefined;
      this._drain();
    }, waitMs);
  }

  /** Serves every waiter the bucket currently covers, then re-arms the timer if any remain. */
  private _drain(): void {
    this._refill();
    while (this._waiters.length > 0) {
      const head = this._waiters[0];
      if (this._tokens < this._needed(head)) break;
      this._tokens -= head.weight; // may drop below zero: the debt later acquisitions wait off
      this._waiters.shift();
      head.resolve();
    }
    if (this._waiters.length > 0) this._schedule();
  }

  /** Tokens `waiter` needs before it may proceed: its weight, capped at what the bucket can hold. */
  private _needed(waiter: Waiter): number {
    return Math.min(waiter.weight, this._capacity);
  }
}
