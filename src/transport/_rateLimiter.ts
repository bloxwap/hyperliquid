/**
 * Token-bucket rate limiter shared by both transports.
 *
 * Hyperliquid budgets REST requests at 1200 weight per minute per IP; exceeding it yields
 * HTTP 429 and ultimately an IP ban. An opt-in instance of this bucket on `HttpTransport`
 * paces outgoing requests: each request acquires its weight before sending and WAITS (instead of
 * throwing) until the bucket has refilled enough to cover it. Weights that only become knowable
 * after the fact (response-size surcharges) are debited with {@linkcode TokenBucketRateLimiter.charge}.
 *
 * The WebSocket transport budgets a different quantity against the same machinery — outbound
 * *messages*, capped at 2000/minute per IP across every connection — through
 * `WebSocketQuota`. Both callers need the identical FIFO-with-debt semantics, so the
 * bucket lives at the transport root rather than under either one.
 * @module
 */

import { Promise_ } from "./_polyfills.ts";

/**
 * A queued acquisition waiting for enough tokens to accumulate.
 *
 * Waiters are nodes of the bucket's doubly-linked FIFO, so enqueue, serving from the head, and
 * abort-driven removal are all O(1) — an `Array.shift`/`splice` queue costs O(n) per operation,
 * which turns a deep backlog into O(n²) total work exactly when throttling bites hardest.
 */
interface Waiter {
  /** Tokens this acquisition needs before it may proceed. */
  weight: number;
  /** Settles the acquisition once its tokens are deducted. */
  resolve: () => void;
  /** Fails the acquisition when its abort signal fires while queued. */
  reject: (reason?: unknown) => void;
  /** The abort signal listened to, so serving can detach the listener. */
  signal?: AbortSignal;
  /** The abort listener, so serving can detach it. */
  onAbort?: () => void;
  /** Previous waiter in the FIFO; cleared on removal. */
  prev?: Waiter;
  /** Next waiter in the FIFO; cleared on removal. */
  next?: Waiter;
}

/** Longest single `setTimeout` slice: 2^31-1 ms, the largest delay Bun/Node accept without clamping to ~1 ms. */
const MAX_TIMER_SLICE_MS = 2_147_483_647;

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
  /** Tokens currently available; negative while paying off an over-capacity acquisition or a post-response debit. */
  private _tokens: number;
  /** Clock reading at the last refill accounting. */
  private _lastRefill: number;
  /** Maximum tokens the bucket can hold. */
  private readonly _capacity: number;
  /** Tokens refilled per millisecond. */
  private readonly _refillPerMs: number;
  /** Head of the linked FIFO: the oldest pending acquisition. */
  private _head: Waiter | undefined;
  /** Tail of the linked FIFO: the newest pending acquisition. */
  private _tail: Waiter | undefined;
  /** Wake-up timer for the head waiter; at most one is armed at a time. */
  private _timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Creates a token bucket.
   *
   * @param capacity Maximum burst size, in weight units. The bucket starts full.
   * @param refillPerMinute Steady-state refill rate, in weight units per minute.
   */
  constructor(capacity: number, refillPerMinute: number) {
    // Infinity and NaN bypass or break the token arithmetic, non-positives stall the queue
    // forever, and a refillPerMinute so small that the derived per-ms rate underflows to zero
    // would leave every queued acquire with an infinite wait — all rejected up front.
    const refillPerMs = refillPerMinute / 60_000;
    if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(refillPerMs) || refillPerMs <= 0) {
      throw new RangeError(
        `TokenBucketRateLimiter: capacity and refillPerMinute must be positive and finite with a usable refill rate (got capacity=${capacity}, refillPerMinute=${refillPerMinute})`,
      );
    }
    this._capacity = capacity;
    this._refillPerMs = refillPerMs;
    this._tokens = capacity;
    this._lastRefill = Date.now();
  }

  /**
   * Deducts `weight` tokens, resolving immediately when the bucket covers the cost and otherwise
   * waiting until the refill rate has accumulated them.
   *
   * Passing a `signal` makes the wait abort-aware: an already-aborted signal rejects without
   * deducting anything, and an abort while queued removes the acquisition from the queue — it
   * never proceeds and never consumes tokens.
   */
  acquire(weight: number, signal?: AbortSignal): Promise<void> {
    // An already-aborted caller never waits and never spends tokens.
    if (signal?.aborted) return Promise.reject(signal.reason);

    // Fast path: nobody is waiting and the bucket covers the cost, so the deduction is all
    // the work there is.
    if (this._head === undefined) {
      this._refill();
      if (this._tokens >= weight) {
        this._tokens -= weight;
        return Promise.resolve();
      }
    }

    const { promise, resolve, reject } = Promise_.withResolvers<void>();
    const waiter: Waiter = { weight, resolve, reject };
    if (signal) {
      const onAbort = (): void => {
        // A waiter is queued exactly when it is the head or is linked on either side; after
        // serving, its links are cleared and the listener is detached, so this never runs.
        const wasHead = this._head === waiter;
        if (!wasHead && waiter.prev === undefined && waiter.next === undefined) return;
        this._remove(waiter);
        // The wake-up was timed for this waiter as head; re-time it for the next in line,
        // whose weight may accumulate sooner.
        if (wasHead && this._timer !== undefined) {
          clearTimeout(this._timer);
          this._timer = undefined;
          if (this._head !== undefined) this._schedule();
        }
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      waiter.signal = signal;
      waiter.onAbort = onAbort;
    }
    this._push(waiter);
    this._schedule();
    return promise;
  }

  /**
   * Debits `weight` tokens without waiting, possibly driving the bucket into debt.
   *
   * For weights that only become knowable after the request completes (Hyperliquid surcharges
   * some info endpoints per returned item), so later acquisitions wait off the real cost instead
   * of the estimate the request was acquired with.
   */
  charge(weight: number): void {
    this._refill();
    this._tokens -= weight;
  }

  /** Accrues the tokens earned since the last accounting, capped at the capacity. */
  private _refill(): void {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    if (elapsed <= 0) return;
    this._tokens = Math.min(this._capacity, this._tokens + elapsed * this._refillPerMs);
    this._lastRefill = now;
  }

  /** Appends a waiter to the FIFO tail. */
  private _push(waiter: Waiter): void {
    const tail = this._tail;
    if (tail !== undefined) {
      tail.next = waiter;
      waiter.prev = tail;
      this._tail = waiter;
    } else {
      this._head = this._tail = waiter;
    }
  }

  /** Unlinks a waiter from the FIFO and clears its links. */
  private _remove(waiter: Waiter): void {
    const { prev, next } = waiter;
    if (prev !== undefined) prev.next = next;
    else this._head = next;
    if (next !== undefined) next.prev = prev;
    else this._tail = prev;
    waiter.prev = waiter.next = undefined;
  }

  /**
   * Arms the wake-up timer for the head waiter, unless one is already armed.
   *
   * Waits longer than {@linkcode MAX_TIMER_SLICE_MS} are scheduled in slices: runtimes clamp an
   * over-long delay to ~1 ms, which would wake the drain immediately and re-arm in a spin. Each
   * early wake re-evaluates the real due time and re-arms, so a year-scale wait costs a handful
   * of slices instead of a busy loop.
   */
  private _schedule(): void {
    if (this._timer !== undefined) return;
    this._refill();
    const deficit = this._needed(this._head!) - this._tokens;
    const waitMs = Math.max(0, Math.ceil(deficit / this._refillPerMs));
    this._timer = setTimeout(
      () => {
        this._timer = undefined;
        this._drain();
      },
      Math.min(waitMs, MAX_TIMER_SLICE_MS),
    );
  }

  /** Serves every waiter the bucket currently covers, then re-arms the timer if any remain. */
  private _drain(): void {
    this._refill();
    while (this._head !== undefined && this._tokens >= this._needed(this._head)) {
      const head = this._head;
      this._tokens -= head.weight; // may drop below zero: the debt later acquisitions wait off
      this._remove(head);
      if (head.onAbort) head.signal?.removeEventListener("abort", head.onAbort);
      head.resolve();
    }
    if (this._head !== undefined) this._schedule();
  }

  /** Tokens `waiter` needs before it may proceed: its weight, capped at what the bucket can hold. */
  private _needed(waiter: Waiter): number {
    return Math.min(waiter.weight, this._capacity);
  }
}
