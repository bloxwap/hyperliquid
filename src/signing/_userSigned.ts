/**
 * User-signed ([EIP-712](https://eips.ethereum.org/EIPS/eip-712)) signing for fund and account actions.
 * @module
 */

import { type AbstractWallet, type Signature, signTypedData } from "./_abstractWallet.ts";
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
  const { wallet, action, types } = args;
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
}): Promise<Signature> {
  // Inject fields for multi-sig; shared across signers of one action, see the memo above.
  const extendedTypes = getMultiSigExtendedTypes(args.types);

  const signature = await signUserSignedAction({
    wallet: args.signer,
    action: {
      payloadMultiSigUser: args.multiSigUser.toLowerCase(),
      outerSigner: args.outerSigner.toLowerCase(),
      ...args.action,
    },
    types: extendedTypes,
  });
  return trimSignature(signature);
}
