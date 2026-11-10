/**
 * Known-answer self-check for the optional `tiny-secp256k1` module.
 *
 * Both the raw-key wallet and {@linkcode createFastLocalWallet} sign with this module, so a build
 * that has the right three functions but the wrong curve, nonce, or recovery id must be refused
 * before it touches a real key. The vector is a fixed key over a fixed digest; the expected
 * signature (64-byte `r || s`, then `v` = 27/28) was captured from viem.
 * @module
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** The subset of the `tiny-secp256k1` API both WASM signers rely on. */
export interface TinySecp256k1 {
  isPrivate(d: Uint8Array): boolean;
  pointFromScalar(d: Uint8Array, compressed?: boolean): Uint8Array | null;
  signRecoverable(h: Uint8Array, d: Uint8Array): { signature: Uint8Array; recoveryId: number };
}

/** Fixed key. Also the well-known test key used across the signing suite. */
const KAT_KEY = hexToBytes("822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff");

/** Fixed 32-byte digest. */
const KAT_DIGEST = new Uint8Array(32).fill(0x07);

/**
 * viem's signature for {@linkcode KAT_KEY} over {@linkcode KAT_DIGEST}: 64-byte `r || s` plus `v`
 * (`1b` = 27). Recovery ids 2 and 3 are rejected by the `{0, 1}` check even though masking with
 * `& 1` would still produce that `v`: Ethereum signatures cannot carry the overflow bit.
 */
const KAT_EXPECTED =
  "0679e17743b3bc599274a8fac074deaa1eb696b6224984f4142a759d81ee6e6d7065f593377652847b9730aa9e2bc2dfe0e1de8bdbdef9bf6ca9c2ac8ded0cf21b";

/** Whether `value` has the three functions the signers call. Does not check that they are correct. */
function hasTinySecp256k1Shape(value: unknown): value is TinySecp256k1 {
  if (typeof value !== "object" || value === null) return false;
  const ecc = value as Partial<TinySecp256k1>;
  return (
    typeof ecc.signRecoverable === "function" &&
    typeof ecc.pointFromScalar === "function" &&
    typeof ecc.isPrivate === "function"
  );
}

/**
 * Whether `ecc` reproduces the known-answer signature.
 *
 * A throw, a short signature, or a recovery id outside `{0, 1}` is a broken module, not an invalid
 * user key. `(recoveryId & ~1) === 0` is the overflow-bit check; it is combined with a strict
 * `0`/`1` test because a bare bitwise mask coerces `undefined` and `NaN` to `0`.
 */
export function tinySecp256k1SelfCheck(ecc: TinySecp256k1): boolean {
  try {
    const { signature, recoveryId } = ecc.signRecoverable(KAT_DIGEST, KAT_KEY);
    return (
      signature instanceof Uint8Array &&
      signature.length === 64 &&
      (recoveryId === 0 || recoveryId === 1) &&
      (recoveryId & ~1) === 0 &&
      bytesToHex(signature) + (27 + (recoveryId & 1)).toString(16) === KAT_EXPECTED
    );
  } catch {
    return false;
  }
}

/**
 * Returns `value` only when it has the required shape and passes {@linkcode tinySecp256k1SelfCheck}.
 * Every other outcome, including a throw from the module, is `undefined` — the caller falls back.
 */
export function acceptTinySecp256k1(value: unknown): TinySecp256k1 | undefined {
  if (!hasTinySecp256k1Shape(value)) return undefined;
  return tinySecp256k1SelfCheck(value) ? value : undefined;
}
