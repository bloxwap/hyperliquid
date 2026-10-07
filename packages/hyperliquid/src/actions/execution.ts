/** Explicit signing and execution of canonical actions. @module */
import { HyperliquidError } from "../_base.ts";
import type { ExchangeConfig } from "../api/exchange/_methods/_base/_config.ts";
import { assertDetachedAllowed } from "../api/exchange/_methods/_base/_dispatch.ts";
import { executeL1Action, executeUserSignedAction } from "../api/exchange/_methods/_base/execute.ts";
import {
  getSigningContext,
  linkSigningContext,
  type PreparedExchangeRequest,
} from "../api/exchange/_methods/_base/_shell.ts";
import { assertSuccessResponse } from "../api/exchange/_methods/_base/errors.ts";
import { actionMetadata, immutableCopy, type CanonicalAction } from "./_canonical.ts";
import { registerExchangeWireRequest } from "../transport/_wire.ts";

export type { CanonicalAction } from "./_canonical.ts";
/** Options for signing/executing an already validated action. */
export interface ActionOptions {
  vaultAddress?: string;
  expiresAfter?: string | number;
  signal?: AbortSignal;
}
/** Immutable signed wire request. Response inference and environment ownership survive in-process. */
export type SignedAction<T> = Readonly<Omit<PreparedExchangeRequest<T>, "signature" | "action">> & {
  readonly action: Readonly<Record<string, unknown>>;
  readonly signature: Readonly<PreparedExchangeRequest<T>["signature"]>;
};
const signedOwners = new WeakMap<object, { key: string; isTestnet: boolean }>();

function run<T>(
  config: ExchangeConfig,
  action: CanonicalAction<unknown>,
  options: ActionOptions | undefined,
  prepare: boolean,
): Promise<T> {
  const info = actionMetadata(action);
  if (info.nonce !== undefined) config = { ...config, nonceManager: (): number => info.nonce! };
  if (info.kind === "l1") return executeL1Action(config, action.payload, options, prepare);
  if (options?.vaultAddress !== undefined || options?.expiresAfter !== undefined) {
    return Promise.reject(new HyperliquidError("User-signed actions do not support vaultAddress or expiresAfter"));
  }
  return executeUserSignedAction(
    config,
    action.payload,
    info.types!,
    {
      signal: options?.signal,
      toMultiSigPayloadAction: info.toMultiSigPayloadAction,
      toSinglePayloadAction: info.toSinglePayloadAction,
    },
    prepare,
  );
}

/**
 * Allocate a nonce and sign a validated action without posting it.
 * @param config Exchange configuration.
 * @param action Action produced by an SDK builder.
 * @param options Signing options and cancellation signal.
 * @return An immutable signed request with the action's response type.
 * @throws {HyperliquidError} When action ownership or dispatch policy is invalid.
 */
export async function signAction<T>(
  config: ExchangeConfig,
  action: CanonicalAction<T>,
  options?: ActionOptions,
): Promise<SignedAction<T>> {
  const request = await run<PreparedExchangeRequest<T>>(config, action, options, true);
  // The unchanged builder payload is already recursively owned/frozen. Retain its identity
  // and serialization caches; the shell's remaining L1 fields are scalar metadata plus the
  // fresh signature. Transformed user actions and multi-sig wrappers still need a full copy.
  const signed =
    request.action === action.payload
      ? Object.freeze({ ...request, signature: immutableCopy(request.signature) })
      : immutableCopy(request);
  registerExchangeWireRequest(signed, signed.action);
  const owner = getSigningContext(request)!;
  signedOwners.set(signed, owner);
  linkSigningContext(signed, owner);
  return signed;
}

/**
 * Submit an owned signed action without signing again.
 * @param config Exchange configuration.
 * @param signed Signed request produced by signAction.
 * @param options Cancellation signal for submission.
 * @return The action's response.
 * @throws {HyperliquidError} When request ownership, network, or dispatch policy is invalid.
 */
export async function submitAction<T>(
  config: ExchangeConfig,
  signed: SignedAction<T>,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const owner = signedOwners.get(signed);
  if (!owner || owner.isTestnet !== config.transport.isTestnet) {
    throw new HyperliquidError("Signed request ownership or network mismatch; rebuild and sign for this network");
  }
  assertDetachedAllowed(owner.key, config.dispatchPolicy);
  const response = await config.transport.request<T>("exchange", signed, options?.signal);
  assertSuccessResponse(response);
  return response;
}

/**
 * Execute a reusable validated action through the coordinated signing path.
 * @param config Exchange configuration.
 * @param action Action produced by an SDK builder.
 * @param options Signing options and cancellation signal.
 * @return The action's response.
 * @throws {HyperliquidError} When action ownership or dispatch policy is invalid.
 */
export function executeAction<T>(
  config: ExchangeConfig,
  action: CanonicalAction<T>,
  options?: ActionOptions,
): Promise<T> {
  try {
    return run<T>(config, action, options, false);
  } catch (error) {
    return Promise.reject(error);
  }
}

export { createNonceManager, type NonceManager } from "../api/exchange/_methods/_base/_nonce.ts";
export type { DispatchPolicy } from "../api/exchange/_methods/_base/_dispatch.ts";
