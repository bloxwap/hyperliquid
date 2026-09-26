/**
 * AbortSignal wiring helpers shared by the transports.
 * @module
 */

import { DOMException_, Promise_ } from "./_polyfills.ts";

/** Shared detach function for relays that need no cleanup. */
function noop(): void {
  // Intentionally empty; a statement keeps coverage tooling from treating the call as unhit.
  return;
}

/** Aborts `target` with a `TimeoutError` after `ms`; `cancel` clears the timer, `reason` identifies the abort. */
export function scheduleTimeout(target: AbortController, ms: number | null): { reason: Error; cancel: () => void } {
  // The TimeoutError is created lazily: a request that settles before the timer fires never needs
  // it. It is memoized because callers classify timeouts by reference (`error === timeout.reason`),
  // so the timer callback and every `reason` read must observe the same object.
  let reason: Error | undefined;
  const getReason = (): Error => (reason ??= new DOMException_("Signal timed out.", "TimeoutError"));
  // `null` disables the timeout. setTimeout also clamps a non-finite delay to
  // 1 ms, which would turn `Infinity` ("never time out") into an instant abort.
  const timeoutId = ms !== null && Number.isFinite(ms) ? setTimeout(() => target.abort(getReason()), ms) : undefined;
  return {
    get reason(): Error {
      return getReason();
    },
    cancel: () => clearTimeout(timeoutId),
  };
}

/** Longest delay `setTimeout` accepts without clamping to ~1 ms: 2^31-1, the same bound the rate limiter slices at. */
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

/** Lazily-created reason behind {@linkcode DISABLED_TIMEOUT}; memoized so reference classification holds. */
let disabledReason: Error | undefined;

/**
 * The handle every disabled timeout shares: no queue entry and no timer exist for it, so one
 * frozen object serves all callers instead of a fresh allocation per schedule. `reason` stays
 * lazy and memoized like a live handle's — callers classify timeouts by reference — and
 * `cancel` is a no-op.
 */
const DISABLED_TIMEOUT: { reason: Error; cancel: () => void } = Object.freeze({
  get reason(): Error {
    return (disabledReason ??= new DOMException_("Signal timed out.", "TimeoutError"));
  },
  cancel: noop,
});

/** A pending timeout: one node of the {@linkcode TimeoutWheel}'s deadline-sorted queue. */
interface TimeoutEntry {
  /**
   * Wall-clock due time, `Date.now() + ms` stamped at schedule time. A delay beyond 2^31-1 ms is
   * clamped to 1 ms up front, mirroring the runtime's own clamp (Bun/Node fire such timers almost
   * immediately, with a `TimeoutOverflowWarning` the wheel does not reproduce): stamping the
   * CLAMPED deadline is what keeps a covered re-arm from re-clamping into a 1 ms spin.
   */
  deadline: number;
  /** Controller aborted with {@linkcode reason} once the deadline passes. */
  target: AbortController;
  /** Memoized abort reason, created lazily — see {@linkcode scheduleTimeout} for why. */
  reason?: Error;
  /** Set by `cancel()`: the entry is drained without aborting when it reaches the head. */
  cancelled: boolean;
}

/**
 * A shared request-timeout scheduler: one deadline-sorted queue with at most ONE armed native
 * timer, replacing {@linkcode scheduleTimeout}'s per-request `setTimeout`/`clearTimeout` pair on
 * the HTTP transport's hot path.
 *
 * Per-request semantics are preserved exactly: the abort fires no earlier than `Date.now() + ms`
 * stamped at schedule time (the callback re-checks the deadline, so an early wake-up only
 * re-arms), with the same lazily-created `TimeoutError` reason, and equal deadlines fire in
 * insertion order, the way same-delay native timers would. What changes is the amortization: a
 * request whose deadline is covered by the already-armed timer — the common case, one transport
 * running requests that share a timeout value — costs a queue insert and nothing else, and
 * cancelling any but the head entry is a flag set. The armed timer is also left in place when the
 * queue drains, so the next schedule usually rides it for free; the callback fires to find an
 * empty queue and disarms. That stale timer is `unref`'d where the platform supports it: while a
 * request is in flight its fetch holds the event loop anyway, and once every request has settled
 * the timer must not extend the process's life (the per-request timers it replaces were cleared
 * on settle).
 */
export class TimeoutWheel {
  /** Live and spent entries, sorted by deadline ascending; equal deadlines keep insertion order. */
  private readonly _entries: TimeoutEntry[];
  /** The single armed native timer, or `undefined` when nothing is armed. */
  private _timer: ReturnType<typeof setTimeout> | undefined;
  /** The deadline {@linkcode _timer} is armed for; never later than the head entry's deadline. */
  private _timerDeadline: number;

  constructor() {
    this._entries = [];
    this._timer = undefined;
    this._timerDeadline = 0;
  }

  /**
   * Arms a timeout for `target`, returning the same handle shape as {@linkcode scheduleTimeout}:
   * `reason` is the lazily-created, memoized `TimeoutError` the abort fires with, and `cancel`
   * withdraws the entry (clear-on-settle).
   *
   * `null` — and any non-finite value — disables the timeout: no queue entry, no timer, just
   * the shared frozen DISABLED_TIMEOUT handle.
   */
  schedule(target: AbortController, ms: number | null): { reason: Error; cancel: () => void } {
    if (ms === null || !Number.isFinite(ms)) return DISABLED_TIMEOUT;
    const entry: TimeoutEntry = {
      deadline: Date.now() + (ms > MAX_TIMEOUT_DELAY_MS ? 1 : ms),
      target,
      reason: undefined,
      cancelled: false,
    };
    // Sorted insert: inserting after existing equals keeps equal deadlines FIFO.
    const entries = this._entries;
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].deadline <= entry.deadline) lo = mid + 1;
      else hi = mid;
    }
    entries.splice(lo, 0, entry);
    // Re-arm only when the entry out-ranks the armed timer; a timer armed for an earlier-or-equal
    // deadline covers it — the callback fires first and re-arms for what remains.
    if (this._timer === undefined || this._timerDeadline > entry.deadline) this._rearm();
    return {
      get reason(): Error {
        return (entry.reason ??= new DOMException_("Signal timed out.", "TimeoutError"));
      },
      cancel: (): void => this._cancel(entry),
    };
  }

  /** Withdraws `entry`: a head entry leaves immediately, mid-queue ones are drained lazily. */
  private _cancel(entry: TimeoutEntry): void {
    if (entry.cancelled) return;
    entry.cancelled = true;
    const entries = this._entries;
    if (entries[0] !== entry) return; // mid-queue: removed when it reaches the head
    do entries.shift();
    while (entries[0]?.cancelled);
    // No re-arm: the timer's deadline is <= the old head's, hence <= the new head's — it still
    // covers the queue. And when the queue ran dry, the armed timer is left stale on purpose
    // (see the class doc): the next schedule then usually skips arming entirely.
  }

  /** Fires every overdue entry in deadline order and re-arms for what remains. */
  private _onTimer(): void {
    this._timer = undefined; // the timer that got us here has fired
    const now = Date.now();
    const entries = this._entries;
    for (;;) {
      const head = entries[0];
      if (head === undefined) break;
      if (head.cancelled) {
        entries.shift();
        continue;
      }
      if (head.deadline > now) break;
      entries.shift();
      // Abort listeners may re-enter the wheel (schedule/cancel from signal handlers): the loop
      // re-reads the head each pass, and the trailing _rearm settles the timer state either way.
      head.target.abort((head.reason ??= new DOMException_("Signal timed out.", "TimeoutError")));
    }
    this._rearm();
  }

  /** (Re)arms the native timer for the current head's deadline; disarms when the queue is empty. */
  private _rearm(): void {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
    const head = this._entries[0];
    if (head === undefined) return;
    this._timerDeadline = head.deadline;
    this._timer = setTimeout(() => this._onTimer(), head.deadline - Date.now());
    // `unref` where the platform exposes it (Bun/Node timer objects); browser and fake timers
    // return a plain number, hence the guarded call — typed through `unknown` because the DOM
    // lib the TypeScript 7 gate compiles against types `setTimeout` as returning `number`.
    (this._timer as unknown as { unref?: () => void }).unref?.();
  }
}

/** Resolves or rejects with `promise`, or rejects with `signal.reason` once `signal` aborts, whichever comes first. */
export function race<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  const aborted = Promise_.withResolvers<never>();
  const onAbort = (): void => aborted.reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([promise, aborted.promise]).finally(() => signal.removeEventListener("abort", onAbort));
}

/** Relays abort events from `sources` into `target` and returns a detach function. */
export function relay(sources: (AbortSignal | null | undefined)[], target: AbortController): () => void {
  // Fast paths avoid allocating the detach controller: no sources means nothing to
  // relay, and a single source can be detached with `removeEventListener` instead.
  let single: AbortSignal | undefined;
  let multiple = false;
  for (const source of sources) {
    if (!source) continue;
    if (single) {
      multiple = true;
      break;
    }
    single = source;
  }

  if (!single) return noop;

  if (!multiple) {
    const source = single;
    if (source.aborted) {
      target.abort(source.reason);
      return noop;
    }
    const onAbort = (): void => target.abort(source.reason);
    source.addEventListener("abort", onAbort, { once: true });
    return () => source.removeEventListener("abort", onAbort);
  }

  // Multiple sources: one listener per source, added with plain `once: true` and removed by a
  // detach loop. The `{ signal }` registration form (a relay controller aborted on detach) costs
  // ~1 µs more per listener in Bun than the manual pair.
  const attached: [AbortSignal, () => void][] = [];
  for (const source of sources) {
    if (!source) continue;
    if (source.aborted) {
      target.abort(source.reason);
      break;
    }
    const onAbort = (): void => target.abort(source.reason);
    source.addEventListener("abort", onAbort, { once: true });
    attached.push([source, onAbort]);
  }
  return () => {
    // A listener that already fired was removed by `once`; removing it again is a no-op.
    for (const [source, onAbort] of attached) source.removeEventListener("abort", onAbort);
  };
}
