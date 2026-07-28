/**
 * User-signed ([EIP-712](https://eips.ethereum.org/EIPS/eip-712)) signing for fund and account actions.
 * @module
 */

import {
  type AbstractWallet,
  canSignRawDigest,
  type Signature,
  signRawDigestBytes,
  signTypedData,
} from "./_abstractWallet.ts";
import { createUserSignedDigestBytes } from "./_fastDigest.ts";
import { trimSignature } from "./_multiSig.ts";

/** EIP-712 type definitions; the hash depends on key and field order. */
type TypedDataTypes = Record<string, readonly { name: string; type: string }[]>;

/** Cache of multi-sig-extended `types` objects (keyed by the original `types` object identity). */
const multiSigExtendedTypesCache = new WeakMap<TypedDataTypes, TypedDataTypes>();

/**
 * Injects the multi-sig fields into `types` after the primary type's first field (memoized per
 * `types` object).
 *
 * A multi-sig action is signed once per authorized signer with the same `types`, and the caches
 * downstream (`viemTypesCache`, `typeFieldNamesCache`) are keyed by object identity — so building a
 * fresh extension per signer would miss every time. Reusing one object turns N misses into one miss
 * plus N-1 hits. The extension is a pure function of `types`, which is what makes identity keying
 * sound: nothing about the signer, the addresses, or the action enters it.
 */
function getMultiSigExtendedTypes(types: TypedDataTypes): TypedDataTypes {
  let extended = multiSigExtendedTypesCache.get(types);
  if (extended === undefined) {
    const primaryType = Object.keys(types)[0];
    const primaryTypeFields = types[primaryType];
    extended = {
      ...types,
      [primaryType]: [
        primaryTypeFields[0],
        { name: "payloadMultiSigUser", type: "address" },
        { name: "outerSigner", type: "address" },
        ...primaryTypeFields.slice(1),
      ],
    };
    multiSigExtendedTypesCache.set(types, extended);
  }
  return extended;
}

/**
 * Signs a user-signed action.
 *
 * @param args The wallet, action, and EIP-712 types.
 * @return The ECDSA signature.
 *
 * @throws {AbstractWalletError} If signing fails.
 *
 * @example
 * ```ts
 * import { signUserSignedAction } from "@bloxwap/hyperliquid/signing";
 * import { ApproveAgentTypes } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x..."); // or any `AbstractWallet`
 *
 * const types = ApproveAgentTypes; // or custom EIP-712 types matching the action
 * const action = {
 *   type: "approveAgent",
 *   signatureChainId: "0x66eee" as const,
 *   hyperliquidChain: "Mainnet",
 *   agentAddress: "0x...",
 *   agentName: "Agent",
 *   nonce: Date.now(),
 * };
 *
 * const signature = await signUserSignedAction({ wallet, action, types });
 * ```
 *
 * @example
 * \- Full cycle of signing and sending a user-signed action to the Hyperliquid API
 * ```ts
 * import { signUserSignedAction } from "@bloxwap/hyperliquid/signing";
 * import { ApproveAgentTypes } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x..."); // or any `AbstractWallet`
 *
 * const types = ApproveAgentTypes; // or custom EIP-712 types matching the action
 * const action = {
 *   type: "approveAgent",
 *   signatureChainId: "0x66eee" as const,
 *   hyperliquidChain: "Mainnet",
 *   agentAddress: "0x...",
 *   agentName: "Agent",
 *   nonce: Date.now(),
 * };
 *
 * const signature = await signUserSignedAction({ wallet, action, types });
 *
 * // Send the signed action to the Hyperliquid API
 * const response = await fetch("https://api.hyperliquid.xyz/exchange", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ action, signature, nonce: action.nonce }),
 * });
 * const body = await response.json();
 * ```
 */
export async function signUserSignedAction<
  TAction extends { signatureChainId: `0x${string}`; [key: string]: unknown },
>(args: {
  /** Wallet to sign the action. */
  wallet: AbstractWallet;
  /** The action to be signed (hex strings must be in lower case). */
  action: TAction;
  /** The types of the action (hash depends on key order). */
  types: Record<string, readonly { name: string; type: string }[]>;
}): Promise<Signature> {
  return signUserSignedActionDigest(args);
}

/**
 * Shared by {@linkcode signUserSignedAction} and {@linkcode signUserSignedInner}.
 *
 * Fast path: a wallet that can sign a raw digest (viem local accounts expose `sign`) signs the
 * hand-rolled digest directly and skips viem's whole EIP-712 encoding (~43 µs → a few µs). The
 * digest is byte-identical — `tests/signing/userSignedDigest.test.ts` pins it against viem's
 * `hashTypedData`. Two kinds of miss fall through to the unchanged typed-data path: a wallet
 * without the raw-digest capability (ledger/remote signers), and a `types` shape or field value
 * the hand-rolled encoder does not reproduce exactly (nested structs, arrays, checksummed
 * mixed-case addresses, …) yields no digest.
 *
 * The capability check comes FIRST: the digest is data-dependent and costs several keccak calls,
 * so computing it for a wallet that would discard it (every remote/ledger wallet) is pure waste —
 * and the lazy-thunk form of `signRawDigestBytes` cannot express "no digest → fall back", so
 * gating on `canSignRawDigest` is how the waste is avoided. `digestThunk`, when given, produces
 * the digest at most once across all signers of one multi-sig call (they all sign the same one).
 */
async function signUserSignedActionDigest(args: {
  wallet: AbstractWallet;
  action: { signatureChainId: `0x${string}`; [key: string]: unknown };
  types: Record<string, readonly { name: string; type: string }[]>;
  digestThunk?: () => Uint8Array | undefined;
}): Promise<Signature> {
  const { wallet, action, types } = args;

  if (canSignRawDigest(wallet)) {
    const digest = args.digestThunk
      ? args.digestThunk()
      : createUserSignedDigestBytes(action, types, action.signatureChainId);
    if (digest !== undefined) {
      const fast = await signRawDigestBytes({ wallet, digest: () => digest });
      if (fast !== undefined) return fast;
    }
  }

  return await signTypedData({
    wallet,
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      // `signatureChainId` is a `0x`-prefixed hex string, so radix 16 is the only correct base here:
      // radix 10 would parse it as `0` and silently sign under the wrong EIP-712 domain.
      chainId: parseInt(action.signatureChainId, 16),
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types,
    primaryType: Object.keys(types)[0],
    message: action,
  });
}

/**
 * Builds the multi-sig-extended types and the action with the multi-sig fields injected — the
 * exact pair the inner per-signer signatures commit to. Shared by {@linkcode signUserSignedInner}
 * and {@linkcode createUserSignedInnerDigestThunk} so the digest and any typed-data fallback can
 * never diverge.
 */
function buildMultiSigInner(args: {
  action: { signatureChainId: `0x${string}`; [key: string]: unknown };
  types: Record<string, readonly { name: string; type: string }[]>;
  multiSigUser: `0x${string}`;
  outerSigner: `0x${string}`;
}): {
  action: { signatureChainId: `0x${string}`; [key: string]: unknown };
  types: Record<string, readonly { name: string; type: string }[]>;
} {
  return {
    // Inject fields for multi-sig; shared across signers of one action, see the memo above.
    types: getMultiSigExtendedTypes(args.types),
    action: {
      payloadMultiSigUser: args.multiSigUser.toLowerCase(),
      outerSigner: args.outerSigner.toLowerCase(),
      ...args.action,
    },
  };
}

/**
 * Returns a thunk producing the digest every inner signer of one multi-sig user-signed action
 * commits to — they all sign the SAME digest, so the thunk computes it on first invocation and
 * memoizes. Invoked only for signers that can actually sign a raw digest (see
 * {@linkcode signUserSignedActionDigest}): when no signer can, the digest is never computed.
 * Package-internal — not re-exported from `mod.ts`.
 *
 * @param args The action, types, and multi-sig parameters (as passed to {@linkcode signUserSignedInner}).
 * @return A memoized thunk producing the 32-byte digest, or `undefined` when the shape is unsupported.
 */
export function createUserSignedInnerDigestThunk(args: {
  /** The action to be authorized (must include `signatureChainId`). */
  action: { signatureChainId: `0x${string}`; [key: string]: unknown };
  /** The types of the action. */
  types: Record<string, readonly { name: string; type: string }[]>;
  /** The multi-sig account address. */
  multiSigUser: `0x${string}`;
  /** The leader address (address of the wallet that signs the outer wrapper). */
  outerSigner: `0x${string}`;
}): () => Uint8Array | undefined {
  let digest: Uint8Array | null | undefined;
  return () => {
    if (digest === undefined) {
      const inner = buildMultiSigInner(args);
      digest = createUserSignedDigestBytes(inner.action, inner.types, inner.action.signatureChainId) ?? null;
    }
    return digest ?? undefined;
  };
}

/**
 * Signs an inner per-signer contribution to a multi-sig user-signed action.
 *
 * Signs the action with `payloadMultiSigUser` and `outerSigner` fields injected
 * (using a type extended after its first field); the returned signature is
 * trimmed for inclusion in the multi-sig wrapper.
 *
 * @param args The signer, action, types, and signing parameters.
 * @return The trimmed ECDSA signature.
 *
 * @throws {AbstractWalletError} If signing fails.
 */
export async function signUserSignedInner(args: {
  /** Inner signer (one of the multi-sig authorized users). */
  signer: AbstractWallet;
  /** The action to be authorized (must include `signatureChainId`). */
  action: { signatureChainId: `0x${string}`; [key: string]: unknown };
  /** The types of the action. */
  types: Record<string, readonly { name: string; type: string }[]>;
  /** The multi-sig account address. */
  multiSigUser: `0x${string}`;
  /** The leader address (address of the wallet that signs the outer wrapper). */
  outerSigner: `0x${string}`;
  /**
   * Shared digest thunk from {@linkcode createUserSignedInnerDigestThunk}: every signer of one
   * multi-sig call signs the same digest, so the caller computes it at most once. When omitted,
   * the digest is computed per call.
   */
  digestThunk?: () => Uint8Array | undefined;
}): Promise<Signature> {
  const inner = buildMultiSigInner(args);
  const signature = await signUserSignedActionDigest({
    wallet: args.signer,
    action: inner.action,
    types: inner.types,
    digestThunk: args.digestThunk,
  });
  return trimSignature(signature);
}
