/**
 * AbortSignal wiring helpers shared by the transports.
 * @module
 */

import { DOMException_, Promise_ } from "./_polyfills.ts";

/** Shared detach function for relays that need no cleanup. */
function noop(): void {}

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

  const detach = new AbortController();
  for (const source of sources) {
    if (!source) continue;
    if (source.aborted) {
      target.abort(source.reason);
      break;
    }
    source.addEventListener("abort", () => target.abort(source.reason), {
      once: true,
      signal: detach.signal,
    });
  }
  return () => detach.abort();
}
