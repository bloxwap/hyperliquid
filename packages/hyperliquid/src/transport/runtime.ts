/**
 * Injectable platform dependencies (clocks, timers, and the random source) used by the transports
 * and their schedulers, so tests can run them on a virtual clock without patching globals.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 *
 * // Retry jitter pinned to zero; every other member falls back to the platform.
 * const transport = new HttpTransport({ retryOnRateLimit: true, runtime: { random: () => 0 } });
 * ```
 *
 * @module
 */

/** Timer handles may be numeric (browsers/fakes) or platform timer objects. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

/**
 * Clock, scheduler, and random source.
 *
 * Wall time ({@linkcode Runtime.now}) is used only where the protocol needs a timestamp: nonces and
 * HTTP-date `Retry-After` headers. Every elapsed-time decision (request deadlines, rate-limit
 * refills, cache expiry, connection-attempt windows) reads {@linkcode Runtime.monotonicNow}, so a
 * wall-clock correction neither fires nor stalls them.
 */
export interface Runtime {
  /** Unix milliseconds. */
  now(): number;
  /** Elapsed milliseconds, independent of wall-clock corrections. */
  monotonicNow(): number;
  /** Schedule a callback. */
  setTimeout(callback: () => void, ms: number): TimerHandle;
  /** Cancel a callback. */
  clearTimeout(handle: TimerHandle | undefined): void;
  /** Schedule a repeating callback. */
  setInterval(callback: () => void, ms: number): TimerHandle;
  /** Cancel a repeating callback. */
  clearInterval(handle: TimerHandle | undefined): void;
  /** Uniform random value in [0, 1). */
  random(): number;
}

/**
 * The platform runtime. Each member reads its global at call time, so polyfills installed after
 * import still apply.
 */
export const systemRuntime: Runtime = {
  now: (): number => Date.now(),
  monotonicNow: (): number => performance.now(),
  setTimeout: (callback: () => void, ms: number): TimerHandle => setTimeout(callback, ms),
  clearTimeout: (handle: TimerHandle | undefined): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback: () => void, ms: number): TimerHandle => setInterval(callback, ms),
  clearInterval: (handle: TimerHandle | undefined): void => clearInterval(handle as ReturnType<typeof setInterval>),
  random: (): number => Math.random(),
};

/** Runtimes produced by {@linkcode resolveRuntime}, returned as-is when resolved again. */
const resolved = new WeakSet<Runtime>();
resolved.add(systemRuntime);

/**
 * Fills the members `overrides` omits from {@linkcode systemRuntime}. Called once per component at
 * construction, never per request. Returns `systemRuntime` itself when nothing is overridden, and
 * an already-resolved runtime unchanged, so components sharing one runtime share one object.
 * Overriding methods keep `overrides` as their receiver, so a stateful fake clock can be passed
 * directly.
 */
export function resolveRuntime(overrides?: Partial<Runtime>): Runtime {
  if (overrides === undefined) return systemRuntime;
  if (resolved.has(overrides as Runtime)) return overrides as Runtime;
  const result: Runtime = { ...systemRuntime };
  for (const key of Object.keys(systemRuntime) as (keyof Runtime)[]) {
    const override = overrides[key];
    if (override !== undefined) Object.assign(result, { [key]: override.bind(overrides) });
  }
  resolved.add(result);
  return result;
}

/**
 * Resolves after `ms` on `runtime`'s scheduler, or rejects with `signal`'s reason once it aborts.
 * The timer and the abort listener are released on every settlement path, and the timer is
 * `unref`'d where the platform supports it, so an abandoned wait never holds the process open.
 */
export function delay(ms: number, runtime: Runtime = systemRuntime, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      runtime.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(signal?.reason);
    };
    const timer = runtime.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    // Same guarded call as the TimeoutWheel: browser and fake timers return a plain number.
    (timer as unknown as { unref?: () => void }).unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
