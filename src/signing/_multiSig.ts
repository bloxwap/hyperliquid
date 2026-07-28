/**
 * Multi-sig wrapper construction and outer signing.
 * @module
 */

import { bytesToHex } from "@noble/hashes/utils.js";
import {
  type AbstractWallet,
  getWalletAddress,
  type Signature,
  signRawDigestBytes,
  signTypedData,
} from "./_abstractWallet.ts";
import { createMultiSigDigestBytes } from "./_fastDigest.ts";
import { createL1ActionHash, createL1ActionHashBytes, preadjustL1Action, signL1Inner } from "./_l1.ts";
import { signUserSignedInner } from "./_userSigned.ts";

/** EIP-712 types for the multi-sig outer wrapper. */
const MULTI_SIG_TYPES = {
  "HyperliquidTransaction:SendMultiSig": [
    { name: "hyperliquidChain", type: "string" },
    { name: "multiSigActionHash", type: "bytes32" },
    { name: "nonce", type: "uint64" },
  ],
};

/** A multi-sig wrapper as it appears on the wire. */
interface MultiSigAction {
  /** Wire-level discriminator. */
  type: "multiSig";
  /** Chain ID in hex format for [EIP-712](https://eips.ethereum.org/EIPS/eip-712) signing. */
  signatureChainId: `0x${string}`;
  /** Trimmed inner signatures from the authorized signers. */
  signatures: readonly Signature[];
  /** The inner authorization payload. */
  payload: {
    /** The multi-sig account address (lowercased). */
    multiSigUser: `0x${string}`;
    /** The leader address (lowercased). */
    outerSigner: `0x${string}`;
    /** The action being authorized. */
    action: Record<string, unknown> | readonly unknown[];
  };
}

/**
 * Signs the multi-sig outer wrapper with the leader's wallet.
 *
 * @param args The leader wallet, the wrapper, and signing parameters.
 * @return The leader's ECDSA signature.
 *
 * @throws {AbstractWalletError} If signing fails.
 */
async function signMultiSigOuter(args: {
  /** Leader wallet (its address must match `wrapper.payload.outerSigner`). */
  leader: AbstractWallet;
  /** The wrapper to sign. */
  wrapper: MultiSigAction;
  /**
   * The inner action already normalized by `preadjustL1Action`. When present, it stands in for
   * `wrapper.payload.action` inside the hash preimage, so the preimage reuses the adjusted
   * subtree instead of re-traversing it. The wrapper itself (and its wire form) is untouched.
   */
  adjustedAction?: unknown;
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
  const { leader, wrapper, nonce, isTestnet = false, vaultAddress, expiresAfter } = args;
  const { type: _, ...wrapperWithoutType } = wrapper;
  const multiSigActionHashBytes = createL1ActionHashBytes({
    action:
      args.adjustedAction === undefined
        ? wrapperWithoutType
        : // Property overwrites keep their original positions, so the preimage key order —
          // `signatureChainId, signatures, payload` / `multiSigUser, outerSigner, action` —
          // is identical to hashing the wrapper itself.
          { ...wrapperWithoutType, payload: { ...wrapper.payload, action: args.adjustedAction } },
    nonce,
    vaultAddress,
    expiresAfter,
  });

  // `signatureChainId` is a `0x`-prefixed hex string, so radix 16 is the only correct base here:
  // radix 10 would parse it as `0` and silently sign under the wrong EIP-712 domain.
  const chainId = parseInt(wrapper.signatureChainId, 16);

  // Fast path: a wallet that can sign a raw digest (viem local accounts expose `sign`) signs the
  // hand-rolled SendMultiSig digest directly and skips viem's whole EIP-712 encoding. The digest
  // is byte-identical — the differential test pins it against viem's `hashTypedData`. The thunk
  // keeps it lazy: wallets without the capability (those that can only sign remotely) fall through to the
  // unchanged typed-data path without paying for a digest they would discard. A chain ID that did
  // not parse to a uint256 word falls through too: viem rejects it, while the hand-rolled digest
  // would silently sign under the wrong domain.
  const fast =
    Number.isSafeInteger(chainId) && chainId >= 0
      ? await signRawDigestBytes({
          wallet: leader,
          digest: () => createMultiSigDigestBytes(multiSigActionHashBytes, nonce, wrapper.signatureChainId, isTestnet),
        })
      : undefined;
  if (fast !== undefined) return fast;

  return await signTypedData({
    wallet: leader,
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: MULTI_SIG_TYPES,
    primaryType: "HyperliquidTransaction:SendMultiSig",
    message: {
      hyperliquidChain: isTestnet ? "Testnet" : "Mainnet",
      multiSigActionHash: `0x${bytesToHex(multiSigActionHashBytes)}`,
      nonce,
    },
  });
}

/**
 * Signs an L1 action with multi-sig orchestration.
 *
 * Collects inner signatures from each signer over `[multiSigUser, outerSigner, action]`,
 * builds the multi-sig wrapper, and signs the wrapper with the leader (first signer).
 *
 * @param args The signers, action, and signing parameters.
 * @return The wrapper action (modified) and the leader's signature.
 *
 * @throws {AbstractWalletError} If signing fails.
 *
 * @example
 * ```ts
 * import { signMultiSigL1 } from "@bloxwap/hyperliquid/signing";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const signers = [
 *   privateKeyToAccount("0x..."),
 *   privateKeyToAccount("0x..."),
 *   // ...more signers if needed
 * ] as const;
 *
 * const action = { type: "cancel", cancels: [{ a: 0, o: 12345 }] };
 * const nonce = Date.now();
 *
 * const { action: wrapper, signature } = await signMultiSigL1({
 *   signers,
 *   multiSigUser: "0x...",
 *   signatureChainId: "0x66eee",
 *   action,
 *   nonce,
 * });
 * ```
 *
 * @example
 * \- Full cycle of signing and sending a multi-sig L1 action to the Hyperliquid API
 * ```ts
 * import { canonicalize, signMultiSigL1 } from "@bloxwap/hyperliquid/signing";
 * import { CancelRequest } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const signers = [
 *   privateKeyToAccount("0x..."),
 *   privateKeyToAccount("0x..."),
 *   // ...more signers if needed
 * ] as const;
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
 * const { action: wrapper, signature } = await signMultiSigL1({
 *   signers,
 *   multiSigUser: "0x...",
 *   signatureChainId: "0x66eee",
 *   action,
 *   nonce,
 * });
 *
 * // Send the multi-sig wrapper to the Hyperliquid API
 * const response = await fetch("https://api.hyperliquid.xyz/exchange", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ action: wrapper, signature, nonce }),
 * });
 * const body = await response.json();
 * ```
 */
export async function signMultiSigL1(args: {
  /** Array of wallets for multi-sig. First wallet is the leader. */
  signers: readonly [AbstractWallet, ...AbstractWallet[]];
  /** The multi-signature account address. */
  multiSigUser: `0x${string}`;
  /** Chain ID in hex format for [EIP-712](https://eips.ethereum.org/EIPS/eip-712) signing. */
  signatureChainId: `0x${string}`;
  /** The action payload. */
  action: Record<string, unknown> | unknown[];
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
}): Promise<{ action: MultiSigAction; signature: Signature }> {
  // --- Resolve leader (outer signer) address ---------------
  const outerSigner = await getWalletAddress(args.signers[0]);

  // --- Normalize the action once for both hashes -----------
  // The action sits in two preimages — the inner payload every signer signs and the outer
  // wrapper the leader signs. Adjust it up front and hand the marker to both, so the second
  // hash reuses the adjusted subtree instead of re-traversing it. The wrapper that goes on
  // the wire keeps the caller's original action object.
  const adjustedAction = preadjustL1Action(args.action);

  // --- Hash the inner payload (identical for every signer) -
  const innerActionHash = createL1ActionHash({
    action: [args.multiSigUser.toLowerCase(), outerSigner.toLowerCase(), adjustedAction],
    nonce: args.nonce,
    vaultAddress: args.vaultAddress,
    expiresAfter: args.expiresAfter,
  });

  // --- Collect inner signatures from all signers -----------
  const innerSignatures = await Promise.all(
    args.signers.map((signer) =>
      signL1Inner({
        signer,
        actionHash: innerActionHash,
        isTestnet: args.isTestnet,
      }),
    ),
  );

  // --- Build wrapper ---------------------------------------
  const wrapper: MultiSigAction = {
    type: "multiSig",
    signatureChainId: args.signatureChainId,
    signatures: innerSignatures,
    payload: {
      multiSigUser: args.multiSigUser.toLowerCase() as `0x${string}`,
      outerSigner,
      action: args.action,
    },
  };

  // --- Sign wrapper with leader ----------------------------
  const signature = await signMultiSigOuter({
    leader: args.signers[0],
    wrapper,
    adjustedAction,
    nonce: args.nonce,
    isTestnet: args.isTestnet,
    vaultAddress: args.vaultAddress,
    expiresAfter: args.expiresAfter,
  });

  return { action: wrapper, signature };
}

/**
 * Signs a user-signed action with multi-sig orchestration.
 *
 * Collects inner signatures from each signer over the action with multi-sig
 * fields injected into its [EIP-712](https://eips.ethereum.org/EIPS/eip-712) type, builds the wrapper, and signs the
 * wrapper with the leader.
 *
 * @param args The signers, action, types, and signing parameters.
 * @return The wrapper action and the leader's signature.
 *
 * @throws {AbstractWalletError} If signing fails.
 *
 * @example
 * ```ts
 * import { signMultiSigUserSigned } from "@bloxwap/hyperliquid/signing";
 * import { ApproveAgentTypes } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const signers = [
 *   privateKeyToAccount("0x..."),
 *   privateKeyToAccount("0x..."),
 *   // ...more signers if needed
 * ] as const;
 *
 * const types = ApproveAgentTypes; // or custom EIP-712 types matching the action
 * const action = {
 *   type: "approveAgent",
 *   signatureChainId: "0x66eee" as const,
 *   hyperliquidChain: "Mainnet" as const,
 *   agentAddress: "0x...",
 *   agentName: "Agent",
 *   nonce: Date.now(),
 * };
 *
 * const { action: wrapper, signature } = await signMultiSigUserSigned({
 *   signers,
 *   multiSigUser: "0x...",
 *   action,
 *   types,
 * });
 * ```
 *
 * @example
 * \- Full cycle of signing and sending a multi-sig user-signed action to the Hyperliquid API
 * ```ts
 * import { signMultiSigUserSigned } from "@bloxwap/hyperliquid/signing";
 * import { ApproveAgentTypes } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const signers = [
 *   privateKeyToAccount("0x..."),
 *   privateKeyToAccount("0x..."),
 *   // ...more signers if needed
 * ] as const;
 *
 * const types = ApproveAgentTypes; // or custom EIP-712 types matching the action
 * const action = {
 *   type: "approveAgent",
 *   signatureChainId: "0x66eee" as const,
 *   hyperliquidChain: "Mainnet" as const,
 *   agentAddress: "0x...",
 *   agentName: "Agent",
 *   nonce: Date.now(),
 * };
 *
 * const { action: wrapper, signature } = await signMultiSigUserSigned({
 *   signers,
 *   multiSigUser: "0x...",
 *   action,
 *   types,
 * });
 *
 * // Send the multi-sig wrapper to the Hyperliquid API
 * const response = await fetch("https://api.hyperliquid.xyz/exchange", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ action: wrapper, signature, nonce: action.nonce }),
 * });
 * const body = await response.json();
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/multi-sig
 */
export async function signMultiSigUserSigned(args: {
  /** Array of wallets for multi-sig. First wallet is the leader. */
  signers: readonly [AbstractWallet, ...AbstractWallet[]];
  /** The multi-signature account address. */
  multiSigUser: `0x${string}`;
  /** The action payload (must include `signatureChainId`, `hyperliquidChain`, and `nonce` or `time`). */
  action: {
    signatureChainId: `0x${string}`;
    hyperliquidChain: "Mainnet" | "Testnet";
    [key: string]: unknown;
  } & ({ nonce: number; time?: never } | { time: number; nonce?: never });
  /** Action serialized into the outer multi-sig payload; defaults to `action`. */
  payloadAction?: Record<string, unknown>;
  /** [EIP-712](https://eips.ethereum.org/EIPS/eip-712) type definitions. */
  types: Record<string, readonly { name: string; type: string }[]>;
}): Promise<{ action: MultiSigAction; signature: Signature }> {
  // --- Resolve leader (outer signer) address ---------------
  const outerSigner = await getWalletAddress(args.signers[0]);

  // --- Collect inner signatures from all signers -----------
  const innerSignatures = await Promise.all(
    args.signers.map((signer) =>
      signUserSignedInner({
        signer,
        action: args.action,
        types: args.types,
        multiSigUser: args.multiSigUser,
        outerSigner,
      }),
    ),
  );

  // --- Build wrapper ---------------------------------------
  const wrapper: MultiSigAction = {
    type: "multiSig",
    signatureChainId: args.action.signatureChainId,
    signatures: innerSignatures,
    payload: {
      multiSigUser: args.multiSigUser.toLowerCase() as `0x${string}`,
      outerSigner,
      action: args.payloadAction ?? args.action,
    },
  };

  // --- Sign wrapper with leader ----------------------------
  const signature = await signMultiSigOuter({
    leader: args.signers[0],
    wrapper,
    nonce: args.action.nonce ?? args.action.time,
    isTestnet: args.action.hyperliquidChain === "Testnet",
  });

  return { action: wrapper, signature };
}

/** Removes leading zeros from signature `r` and `s` (required for multi-sig signatures). */
export function trimSignature(sig: Signature): Signature {
  return {
    r: sig.r.replace(/^0x0+/, "0x") as `0x${string}`,
    s: sig.s.replace(/^0x0+/, "0x") as `0x${string}`,
    v: sig.v,
  };
}
