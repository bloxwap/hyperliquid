/**
 * Execute helpers for L1 and user-signed Exchange API actions.
 * @module
 */

import * as v from "valibot";
import { HyperliquidError, parse } from "../../../../_base.ts";
import {
  getWalletChainId,
  signL1Action,
  signMultiSigL1,
  signMultiSigUserSigned,
  signUserSignedAction,
} from "../../../../signing/mod.ts";
import { Address, Hex, UnsignedInteger } from "../../../_schemas.ts";
import type { ExchangeConfig } from "./_config.ts";
import { executeWithShell } from "./_shell.ts";

// ============================================================
// Schemas
// ============================================================

/** Schema for the optional vault address request option. */
const OptionalVaultAddressSchema = /* @__PURE__ */ (() => {
  return v.optional(Address);
})();

/** Schema for the optional expiration time request option. */
const OptionalExpiresAfterSchema = /* @__PURE__ */ (() => {
  return v.optional(UnsignedInteger);
})();

// ============================================================
// Execute L1 Action
// ============================================================

/**
 * Execute an L1 action on the Hyperliquid Exchange.
 *
 * Handles both single-wallet and multi-sig signing.
 *
 * @param config Exchange API configuration.
 * @param action Action payload to execute.
 * @param options Additional options for the request.
 * @return API response.
 *
 * @throws {ValidationError} If the request options fail validation.
 * @throws {ApiRequestError} If the API returns an error response.
 */
export function executeL1Action<T>(
  config: ExchangeConfig,
  action: Record<string, unknown>,
  options?: {
    vaultAddress?: string;
    expiresAfter?: string | number;
    signal?: AbortSignal;
    /** Skip validation of `vaultAddress`/`expiresAfter`. See the `skipValidation` option in `_config.ts`. */
    skipValidation?: boolean;
  },
): Promise<T> {
  // Resolve options synchronously on the common path (no function-valued `defaultExpiresAfter`),
  // returning the inner promise directly instead of paying the extra async hops of an `async`
  // function. Sync throws (validation errors, throwing getters) are converted into rejections so
  // the observable surface matches the previous `async` declaration exactly.
  try {
    // Validate options before acquiring the lock (unless the caller opted out via `skipValidation`).
    const vaultAddressInput = options?.vaultAddress ?? config.defaultVaultAddress;
    const expiresAfterInput = options?.expiresAfter ?? config.defaultExpiresAfter;
    if (typeof expiresAfterInput === "function") {
      // Rare path: a function-valued default may resolve asynchronously. A sync throw from the
      // function itself lands in the catch below and becomes a rejection, as before.
      return Promise.resolve(expiresAfterInput()).then((resolved) =>
        executeL1ActionResolved(config, action, vaultAddressInput, resolved, options),
      );
    }
    return executeL1ActionResolved(config, action, vaultAddressInput, expiresAfterInput, options);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Validates the resolved options and dispatches the signed request via {@linkcode executeWithShell}. */
function executeL1ActionResolved<T>(
  config: ExchangeConfig,
  action: Record<string, unknown>,
  vaultAddressInput: string | undefined,
  expiresAfterInput: string | number | undefined,
  options?: {
    signal?: AbortSignal;
    skipValidation?: boolean;
  },
): Promise<T> {
  const vaultAddress = options?.skipValidation
    ? (vaultAddressInput as `0x${string}` | undefined)
    : vaultAddressInput === undefined
      ? undefined // `parse(optional(...))` on undefined always yields undefined — skip the call
      : parse(OptionalVaultAddressSchema, vaultAddressInput);
  const expiresAfter = options?.skipValidation
    ? (expiresAfterInput as number | undefined)
    : expiresAfterInput === undefined
      ? undefined
      : parse(OptionalExpiresAfterSchema, expiresAfterInput);

  return executeWithShell<T>(
    config,
    async (nonce) => {
      if ("wallet" in config) {
        const signature = await signL1Action({
          wallet: config.wallet,
          action,
          nonce,
          isTestnet: config.transport.isTestnet,
          vaultAddress,
          expiresAfter,
        });
        return { action, signature, extras: { vaultAddress, expiresAfter } };
      } else {
        const { action: wrapper, signature } = await signMultiSigL1({
          signers: config.signers,
          multiSigUser: config.multiSigUser,
          signatureChainId: await resolveSignatureChainId(config),
          action,
          nonce,
          isTestnet: config.transport.isTestnet,
          vaultAddress,
          expiresAfter,
        });
        return { action: wrapper, signature, extras: { vaultAddress, expiresAfter } };
      }
    },
    options?.signal,
  );
}

// ============================================================
// Execute User-Signed Action
// ============================================================

/**
 * Execute a user-signed action (EIP-712) on the Hyperliquid Exchange.
 *
 * Handles both single-wallet and multi-sig signing.
 *
 * @param config Exchange API configuration.
 * @param action Action payload to execute.
 * @param types EIP-712 type definitions for signing.
 * @param options Additional options for the request.
 * @return API response.
 *
 * @throws {ValidationError} If the request options fail validation.
 * @throws {ApiRequestError} If the API returns an error response.
 */
export function executeUserSignedAction<T>(
  config: ExchangeConfig,
  action: Record<string, unknown>,
  types: Record<string, readonly { name: string; type: string }[]>,
  options?: {
    /** Transforms the completed action into its outer multi-sig payload representation. */
    toMultiSigPayloadAction?: (action: Readonly<Record<string, unknown>>) => Record<string, unknown>;
    signal?: AbortSignal;
  },
): Promise<T> {
  return executeWithShell<T>(
    config,
    async (nonce) => {
      // --- Construct full action (type, system fields, user fields, nonce/time)
      const { type, ...restAction } = action;
      const nonceFieldName = extractNonceFieldName(types);
      const baseFields = {
        type,
        signatureChainId: await resolveSignatureChainId(config),
        hyperliquidChain: config.transport.isTestnet ? "Testnet" : "Mainnet",
      } as const;
      const fullAction =
        nonceFieldName === "nonce"
          ? { ...baseFields, ...restAction, nonce }
          : { ...baseFields, ...restAction, time: nonce };

      // --- Sign (single-wallet or multi-sig) -------------------
      if ("wallet" in config) {
        const signature = await signUserSignedAction({
          wallet: config.wallet,
          action: fullAction,
          types,
        });
        return { action: fullAction, signature };
      } else {
        const payloadAction = options?.toMultiSigPayloadAction?.(fullAction) ?? fullAction;
        const { action: wrapper, signature } = await signMultiSigUserSigned({
          signers: config.signers,
          multiSigUser: config.multiSigUser,
          action: fullAction,
          payloadAction,
          types,
        });
        return { action: wrapper, signature };
      }
    },
    options?.signal,
  );
}

// ============================================================
// Helpers
// ============================================================

/** Cache of the nonce field name per `types` object (keyed by object identity). */
const nonceFieldNameCache = new WeakMap<Record<string, readonly { name: string; type: string }[]>, "nonce" | "time">();

/** Extracts the nonce field name ("nonce" or "time") from EIP-712 type definitions (memoized per `types` object). */
function extractNonceFieldName(types: Record<string, readonly { name: string; type: string }[]>): "nonce" | "time" {
  let name = nonceFieldNameCache.get(types);
  if (name === undefined) {
    const primaryType = Object.keys(types)[0];
    const field = types[primaryType].find((f) => f.name === "nonce" || f.name === "time");
    if (!field) {
      throw new HyperliquidError(`EIP-712 types must contain a "nonce" or "time" field in "${primaryType}"`);
    }
    name = field.name as "nonce" | "time";
    nonceFieldNameCache.set(types, name);
  }
  return name;
}

/**
 * Cache of the parsed static `signatureChainId` per config object (keyed by object identity).
 * A function-valued `signatureChainId` is re-resolved on every request instead — it may return a
 * different value each time, which is precisely why the config accepts a function. The raw string
 * is kept alongside the parsed value so a mutated config re-parses instead of signing stale.
 */
const staticSignatureChainIdCache = new WeakMap<ExchangeConfig, { raw: string; parsed: `0x${string}` }>();

/**
 * Resolves signature chain ID from config, or falls back to the leader wallet's chain ID.
 *
 * Deliberate divergence from the Python SDK, which hardcodes `"0x66eee"` in `sign_user_signed_action`:
 * Python's own comment notes the signatureChainId "is the chain used by the wallet to sign and can be any
 * chain", and the exchange accepts any chain ID for the user-signed domain (only `hyperliquidChain` is
 * validated against the environment). Resolving the wallet's actual chain keeps the EIP-712 domain honest
 * about where the signature was produced.
 */
async function resolveSignatureChainId(config: ExchangeConfig): Promise<`0x${string}`> {
  if (config.signatureChainId) {
    if (typeof config.signatureChainId === "function") {
      return parse(Hex, await config.signatureChainId());
    }
    // Static string: the valibot parse result is a pure function of the string, so cache it.
    const raw = config.signatureChainId;
    let entry = staticSignatureChainIdCache.get(config);
    if (entry === undefined || entry.raw !== raw) {
      entry = { raw, parsed: parse(Hex, raw) };
      staticSignatureChainIdCache.set(config, entry);
    }
    return entry.parsed;
  }
  const leader = "wallet" in config ? config.wallet : config.signers[0];
  return await getWalletChainId(leader);
}
