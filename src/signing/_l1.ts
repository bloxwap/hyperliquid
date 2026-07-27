/**
 * L1 (phantom-agent) signing for trading actions.
 * @module
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { type AbstractWallet, type Signature, signRawDigestBytes, signTypedData } from "./_abstractWallet.ts";
import { createL1AgentDigestBytes } from "./_fastDigest.ts";
import { keccak256 } from "./_keccak.ts";
import { MsgpackWriter } from "./_msgpack.ts";
import { trimSignature } from "./_multiSig.ts";

/**
 * Input shape of {@linkcode adjust}. Mirrors {@linkcode MsgpackValue}, except that the `Uint8Array` arm is
 * intersected with a string index signature so `adjust`'s rebuild of exotic objects type-checks
 * without a cast. Kept local because it is a quirk of `adjust`, not of the encoder.
 */
type ValueType =
  | string
  | number
  | bigint
  | boolean
  | null
  | (Uint8Array & { [key: string]: ValueType })
  | ValueType[]
  | { [key: string]: ValueType };

/** EIP-712 domain for L1 (phantom-agent) signing. */
const L1_DOMAIN = Object.freeze({
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000" as `0x${string}`,
});

/** EIP-712 types for the L1 `Agent` message. */
const L1_AGENT_TYPES = Object.freeze({
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
});

/**
 * Reused across calls so the hash preimage costs no allocation beyond the writer's one-time buffer.
 * Safe because {@linkcode createL1ActionHash} is synchronous; {@linkcode ACTION_WRITER_BUSY} covers the one
 * way it can still overlap with itself.
 */
const ACTION_WRITER = new MsgpackWriter();

/**
 * Guards {@linkcode ACTION_WRITER} against re-entrancy. `adjust` may return the caller's own object, so a
 * getter on a caller-supplied action can call back into {@linkcode createL1ActionHash} while the outer call
 * is mid-write. Sharing one buffer across those two calls would splice the inner preimage into the outer
 * one and hash — and sign — the wrong bytes, so a nested call gets its own writer instead.
 */
let ACTION_WRITER_BUSY = false;

/**
 * Creates a hash of the L1 action.
 *
 * @param args The action and metadata to hash.
 * @return The keccak256 hash as a hex string.
 *
 * @example
 * ```ts
 * import { createL1ActionHash } from "@bloxwap/hyperliquid/signing";
 *
 * const action = { type: "cancel", cancels: [{ a: 0, o: 12345 }] };
 * const nonce = Date.now();
 *
 * const actionHash = createL1ActionHash({ action, nonce });
 * ```
 */
export function createL1ActionHash(args: {
  /** The action to be hashed (hash depends on key order). */
  action: Record<string, unknown> | unknown[];
  /** The current timestamp in ms. */
  nonce: number;
  /** Optional vault address used in the action. */
  vaultAddress?: `0x${string}`;
  /** Optional expiration time of the action in ms since the epoch. */
  expiresAfter?: number;
}): `0x${string}` {
  return `0x${bytesToHex(createL1ActionHashBytes(args))}`;
}

/**
 * Bytes-level variant of {@linkcode createL1ActionHash}: returns the 32-byte hash as `Uint8Array`,
 * so the L1 signing path passes bytes end-to-end (hash → Agent digest → raw-digest wallet) instead
 * of round-tripping through hex. Package-internal — not re-exported from `mod.ts`.
 *
 * @param args The action and metadata to hash.
 * @return The 32-byte keccak256 hash.
 */
export function createL1ActionHashBytes(args: {
  /** The action to be hashed (hash depends on key order). */
  action: Record<string, unknown> | unknown[];
  /** The current timestamp in ms. */
  nonce: number;
  /** Optional vault address used in the action. */
  vaultAddress?: `0x${string}`;
  /** Optional expiration time of the action in ms since the epoch. */
  expiresAfter?: number;
}): Uint8Array {
  const { action, nonce, vaultAddress, expiresAfter } = args;

  const nested = ACTION_WRITER_BUSY;
  const writer = nested ? new MsgpackWriter() : ACTION_WRITER;
  ACTION_WRITER_BUSY = true;
  try {
    // Layout: actionBytes ‖ nonce(u64) ‖ vaultMarker ‖ vault(20) ‖ expiresMarker ‖ expires(u64)
    writer.reset();
    writer.value(adjust(action as ValueType));
    writer.uint64(nonce);

    if (vaultAddress) {
      writer.byte(1);
      writer.raw(hexToBytes(vaultAddress.slice(2)));
    } else {
      writer.byte(0);
    }

    if (expiresAfter !== undefined) {
      writer.byte(0);
      writer.uint64(expiresAfter);
    }

    // `view()` aliases the writer's buffer; nothing writes to it again before `keccak256` consumes it.
    return keccak256(writer.view());
  } finally {
    ACTION_WRITER_BUSY = nested;
  }
}

/**
 * Opaque marker wrapping a subtree that has already been through {@linkcode adjust} (see
 * {@linkcode preadjustL1Action}). `adjust` unwraps it on sight instead of re-traversing, so the
 * marker never reaches the encoder: `adjust` walks the same tree the encoder will see.
 */
class Adjusted {
  constructor(/** The adjusted subtree. */ readonly value: ValueType) {}
}

/**
 * Normalizes a value into a shape {@linkcode MsgpackWriter} encodes the way Hyperliquid expects on the wire:
 * - drops `undefined` properties (otherwise the encoder throws)
 * - widens safe-integer `number`s outside the int32 range to `BigInt` (otherwise they would be encoded as
 *   float64 instead of int64)
 *
 * Integral doubles beyond the safe-integer range (e.g. `1e300`) are NOT widened: the `BigInt` would exceed
 * 64 bits and the encoder would throw "Cannot safely encode bigint larger than 64 bits", while Python's
 * msgpack — and `@std/msgpack`, this encoder's reference oracle — emits them as float64. They pass through
 * as-is. `tests/signing/msgpack.test.ts` pins the `1e300` conformance against the oracle.
 *
 * Returns the ORIGINAL reference when a subtree needs no modification (the common case) — which is why the
 * encoder must treat the result as caller-owned data that may still have getters on it.
 */
function adjust(value: ValueType): ValueType {
  // A subtree already adjusted by {@linkcode preadjustL1Action} — unwrap it without re-traversing.
  if (value instanceof Adjusted) return value.value;
  if (Array.isArray(value)) {
    // Allocate a new array only if some element changes (holes are skipped, like `Array.prototype.map`)
    let changed = false;
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) continue;
      if (adjust(value[i]) !== value[i]) {
        changed = true;
        break;
      }
    }
    return changed ? value.map(adjust) : value;
  }
  if (typeof value === "object" && value !== null) {
    // Fast path is limited to plain objects; exotic objects (e.g., `Uint8Array`) keep the legacy rebuild.
    // `Object.keys` — never `for...in`: the encoder hashes own enumerable keys only, so inherited
    // enumerable props (class instances, prototype pollution) must not be promoted into the rebuild.
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      let changed = false;
      for (const key of Object.keys(value)) {
        const entry = value[key];
        if (entry === undefined || adjust(entry) !== entry) {
          changed = true;
          break;
        }
      }
      if (!changed) return value;
    }
    const result: Record<string, ValueType> = {};
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (entry !== undefined) result[key] = adjust(entry);
    }
    return result;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && (value >= 0x100000000 || value < -0x80000000)) {
    return BigInt(value);
  }
  return value;
}

/**
 * Runs the {@linkcode adjust} normalization over an L1 action once and wraps the result in an
 * {@linkcode Adjusted} marker. A {@linkcode createL1ActionHash} preimage containing the marker
 * reuses the adjusted subtree instead of re-traversing it — multi-sig hashes the same action
 * twice (inner payload and outer wrapper), so the second hash would otherwise redo the walk.
 *
 * The marker hashes byte-identically to the raw action: `adjust` is deterministic and idempotent,
 * so the subtree computed here is exactly what re-running `adjust` over the action would produce.
 * It is only meaningful inside L1 action-hash preimages — never place it in the wire payload
 * (the multi-sig wrapper keeps the caller's original action object).
 *
 * @param action The action to normalize once.
 * @return An opaque marker standing in for the action inside hash preimages.
 */
export function preadjustL1Action(action: Record<string, unknown> | unknown[]): unknown {
  return new Adjusted(adjust(action as ValueType));
}

/**
 * Signs an L1 action.
 *
 * @param args The wallet, action, and signing parameters.
 * @return The ECDSA signature.
 *
 * @throws {AbstractWalletError} If signing fails.
 *
 * @example
 * ```ts
 * import { signL1Action } from "@bloxwap/hyperliquid/signing";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x..."); // or any `AbstractWallet`
 *
 * const action = { type: "cancel", cancels: [{ a: 0, o: 12345 }] };
 * const nonce = Date.now();
 *
 * const signature = await signL1Action({ wallet, action, nonce });
 * ```
 *
 * @example
 * \- Full cycle of signing and sending an L1 action to the Hyperliquid API
 * ```ts
 * import { canonicalize, signL1Action } from "@bloxwap/hyperliquid/signing";
 * import { CancelRequest } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x..."); // or any `AbstractWallet`
 *
 * //             For correct hashing, keys in the L1 action must be in
 * //             the same order as in the schema definition
 * //             ⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * const action = canonicalize(CancelRequest.entries.action, {
 *   type: "cancel",
 *   cancels: [{ a: 0, o: 12345 }],
 * });
 * const nonce = Date.now();
 *
 * const signature = await signL1Action({ wallet, action, nonce });
 *
 * // Send the signed action to the Hyperliquid API
 * const response = await fetch("https://api.hyperliquid.xyz/exchange", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ action, signature, nonce }),
 * });
 * const body = await response.json();
 * ```
 */
export async function signL1Action<TAction extends Record<string, unknown> | unknown[]>(args: {
  /** Wallet to sign the action. */
  wallet: AbstractWallet;
  /** The action to be signed (hash depends on key order). */
  action: TAction;
  /** The current timestamp in ms. */
  nonce: number;
  /**
   * Indicates if the action is for the testnet.
   *
   * Default: `false`
   */
  isTestnet?: boolean;
  /** Optional vault address used in the action. */
  vaultAddress?: `0x${string}`;
  /** Optional expiration time of the action in ms since the epoch. */
  expiresAfter?: number;
}): Promise<Signature> {
  const { wallet, action, nonce, isTestnet = false, vaultAddress, expiresAfter } = args;
  const actionHashBytes = createL1ActionHashBytes({ action, nonce, vaultAddress, expiresAfter });
  // No try/catch in scope: return the promise directly instead of paying an extra async hop.
  return signL1ActionHash({ wallet, actionHashBytes, isTestnet });
}

/** Signs a precomputed L1 action hash as the `connectionId` of an `Agent` message. */
async function signL1ActionHash(args: {
  /** Wallet to sign the hash. */
  wallet: AbstractWallet;
  /** The precomputed 32-byte action hash. */
  actionHashBytes: Uint8Array;
  /**
   * Indicates if the action is for the testnet.
   *
   * Default: `false`
   */
  isTestnet?: boolean;
}): Promise<Signature> {
  const { wallet, actionHashBytes, isTestnet = false } = args;

  // Fast path: a wallet that can sign a raw digest (viem local accounts expose `sign`) signs the
  // hand-rolled Agent digest directly and skips viem's whole EIP-712 encoding. The digest is
  // byte-identical — the differential test pins it against viem's `hashTypedData`. The thunk keeps
  // it lazy: wallets without the capability (every JSON-RPC wallet) fall through to the unchanged
  // typed-data path without paying for a digest they would discard.
  const fast = await signRawDigestBytes({
    wallet,
    digest: () => createL1AgentDigestBytes(actionHashBytes, isTestnet),
  });
  if (fast !== undefined) return fast;

  return signTypedData({
    wallet,
    domain: L1_DOMAIN,
    types: L1_AGENT_TYPES,
    primaryType: "Agent",
    message: {
      source: isTestnet ? "b" : "a",
      connectionId: `0x${bytesToHex(actionHashBytes)}`,
    },
  });
}

/**
 * Signs an inner per-signer contribution to a multi-sig L1 action.
 *
 * Signs the precomputed hash of `[multiSigUser, outerSigner, action]` (identical for
 * every signer, so the caller computes it once); the returned signature is trimmed
 * for inclusion in the multi-sig wrapper.
 *
 * @param args The signer and signing parameters.
 * @return The trimmed ECDSA signature.
 *
 * @throws {AbstractWalletError} If signing fails.
 */
export async function signL1Inner(args: {
  /** Inner signer (one of the multi-sig authorized users). */
  signer: AbstractWallet;
  /** Precomputed hash of `[multiSigUser, outerSigner, action]` (addresses lowercased) with the request nonce. */
  actionHash: `0x${string}`;
  /**
   * Indicates if the action is for the testnet.
   *
   * Default: `false`
   */
  isTestnet?: boolean;
}): Promise<Signature> {
  const signature = await signL1ActionHash({
    wallet: args.signer,
    actionHashBytes: hexToBytes(args.actionHash.slice(2)),
    isTestnet: args.isTestnet,
  });
  return trimSignature(signature);
}
