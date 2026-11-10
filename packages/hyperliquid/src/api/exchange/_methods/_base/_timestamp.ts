/**
 * Cheap checks that a nonce or `expiresAfter` is a millisecond timestamp inside the
 * exchange's acceptance window. Run in every dispatch mode, including `skipValidation`.
 * @module
 */

import { HyperliquidError } from "../../../../_base.ts";

/** A nonce must lie within `(now - 2 days, now + 1 day)` when it arrives. */
export const NONCE_MAX_AGE_MS = 2 * 86_400_000;
/** Inclusive lead the exchange rejects: `nonce >= now + 1 day` is outside the window. */
export const NONCE_MAX_LEAD_MS = 86_400_000;

/**
 * Millisecond epochs below this are not a live Hyperliquid timestamp.
 *
 * `1e12` is 2001-09-09. A seconds value (`Math.floor(Date.now() / 1000)`, about `1.7e9` in 2026)
 * and any other pre-2001 integer fall under it. A real millisecond nonce in the protocol window
 * is about `1.7e12`.
 */
const MILLISECOND_TIMESTAMP_FLOOR = 1_000_000_000_000;

/** Wall clock for the check: the config's `runtime.now` when one was injected, otherwise `Date.now`. */
export function actionClock(runtime: { now?: () => number } | undefined): number {
  return runtime !== undefined && runtime.now !== undefined ? runtime.now() : Date.now();
}

/**
 * Rejects a nonce that is not a safe-integer millisecond timestamp inside the protocol window.
 *
 * The failure path builds the message. The success path is a handful of comparisons so it can sit
 * on every signed action, including the default manager and `skipValidation`.
 *
 * @throws {HyperliquidError} When `nonce` is fractional, seconds-scale, or outside the window.
 */
export function assertNonceTimestamp(nonce: number, now: number): void {
  if (
    !Number.isSafeInteger(nonce) ||
    nonce < MILLISECOND_TIMESTAMP_FLOOR ||
    nonce <= now - NONCE_MAX_AGE_MS ||
    nonce >= now + NONCE_MAX_LEAD_MS
  ) {
    rejectNonce(nonce);
  }
}

/**
 * Rejects an `expiresAfter` that is not a future millisecond timestamp inside the same window.
 *
 * The effective range is `(now, now + 1 day)`. A seconds value fails the millisecond floor with
 * an explicit unit error instead of a generic "expired".
 *
 * @throws {HyperliquidError} When `expiresAfter` is fractional, seconds-scale, past, or too far ahead.
 */
export function assertExpiresAfterTimestamp(expiresAfter: number, now: number): void {
  if (
    !Number.isSafeInteger(expiresAfter) ||
    expiresAfter < MILLISECOND_TIMESTAMP_FLOOR ||
    expiresAfter <= now ||
    expiresAfter >= now + NONCE_MAX_LEAD_MS
  ) {
    rejectExpiresAfter(expiresAfter, now);
  }
}

function rejectNonce(nonce: number): never {
  if (!Number.isSafeInteger(nonce)) {
    throw new HyperliquidError(`Nonce must be a safe integer millisecond timestamp, received ${String(nonce)}`);
  }
  if (nonce < MILLISECOND_TIMESTAMP_FLOOR) {
    throw new HyperliquidError(
      `Nonce must be a millisecond timestamp, received ${nonce}. ` +
        "A seconds value such as Math.floor(Date.now() / 1000) is about 1000× too small.",
    );
  }
  throw new HyperliquidError(`Nonce ${nonce} is outside the protocol timestamp window (now - 2 days, now + 1 day)`);
}

function rejectExpiresAfter(expiresAfter: number, now: number): never {
  if (!Number.isSafeInteger(expiresAfter)) {
    throw new HyperliquidError(
      `expiresAfter must be a safe integer millisecond timestamp, received ${String(expiresAfter)}`,
    );
  }
  if (expiresAfter < MILLISECOND_TIMESTAMP_FLOOR) {
    throw new HyperliquidError(
      `expiresAfter must be a millisecond timestamp, received ${expiresAfter}. ` +
        "A seconds value such as Math.floor(Date.now() / 1000) is about 1000× too small.",
    );
  }
  if (expiresAfter <= now) {
    throw new HyperliquidError(
      `expiresAfter ${expiresAfter} is already expired; it must be a future millisecond timestamp`,
    );
  }
  throw new HyperliquidError(
    `expiresAfter ${expiresAfter} is outside the protocol timestamp window (now, now + 1 day)`,
  );
}
