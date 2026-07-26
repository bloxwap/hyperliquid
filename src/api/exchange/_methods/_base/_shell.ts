/**
 * Common execution shell shared by L1 and user-signed Exchange API actions.
 * @module
 */

import { getWalletAddress, type Signature } from "../../../../signing/mod.ts";
import type { ExchangeConfig } from "./_config.ts";
import { assertSuccessResponse } from "./errors.ts";
import { globalNonceManager } from "./_nonce.ts";
import { withLock } from "./_semaphore.ts";

/** Result returned by the {@linkcode executeWithShell} `build` callback. */
export interface BuildResult {
  /** The final action to send (post-signing). Shape is opaque to the shell — passed through to the transport. */
  action: unknown;
  /** The signature to send. */
  signature: Signature;
  /** Optional extra fields to merge into the request payload (e.g., `vaultAddress`, `expiresAfter`). */
  extras?: Record<string, unknown>;
}

/**
 * A fully signed Exchange request captured before submission: the exact wire payload of one
 * Exchange API call, ready to be posted later via `submitPrepared`.
 *
 * Produced by `prepareRequest`. The signature commits to `action` and `nonce`, and the nonce was
 * consumed at prepare time. The payload stays valid while its nonce is among the 100 highest the
 * exchange has seen from the wallet (and within the block-timestamp window) — it goes stale only
 * after 100 newer nonces have been consumed.
 *
 * @template T Response type of the method the payload was prepared with (type-level only).
 */
export interface PreparedExchangeRequest<T = unknown> {
  /** The final action as posted (canonicalized; the multi-sig wrapper when applicable). */
  action: Record<string, unknown>;
  /** The leader's ECDSA signature over the action and nonce. */
  signature: Signature;
  /** Nonce (timestamp in ms) the signature commits to. */
  nonce: number;
  /** Vault address, when the request trades on behalf of a vault or sub-account. */
  vaultAddress?: string;
  /** Expiration time of the action, when set. */
  expiresAfter?: number;
  /**
   * Phantom carrier of the wrapped method's response type — never set at runtime; it only lets
   * `submitPrepared` infer the response type of the method the payload was prepared with.
   */
  readonly __responseType?: T;
}

// ============================================================
// Prepared-payload poison state (internal)
// ============================================================

/**
 * Mutable state shared between a `prepareRequest` capture transport and the payload it produced.
 *
 * The capture transport increments {@linkcode PreparedRequestState.invalidAttempts} on ANY invalid
 * attempt — a request to a non-`exchange` endpoint, a second request, or a request attempted after
 * `prepareRequest` settled. Because the state is shared by reference, an attempt that begins only
 * after `prepareRequest` returned (leaked callback work) still lands here, and `submitPrepared`
 * rejects the poisoned payload when it re-checks (a point-in-time, best-effort check).
 */
export interface PreparedRequestState {
  /** Number of invalid attempts recorded by the capture transport. */
  invalidAttempts: number;
}

/**
 * In-process link from a prepared payload to its capture-transport state. A `WeakMap` (rather than
 * a property on the payload) keeps the wire body untouched; the link is intentionally lost when a
 * payload is serialized and re-parsed (the poison guard is an in-process guard only).
 */
const preparedRequestStates = new WeakMap<PreparedExchangeRequest<unknown>, PreparedRequestState>();

/** Links a prepared payload to its capture-transport state (called by `prepareRequest`). */
export function linkPreparedRequestState(
  prepared: PreparedExchangeRequest<unknown>,
  state: PreparedRequestState,
): void {
  preparedRequestStates.set(prepared, state);
}

/** Returns the capture-transport state of a prepared payload, if any (called by `submitPrepared`). */
export function getPreparedRequestState(prepared: PreparedExchangeRequest<unknown>): PreparedRequestState | undefined {
  return preparedRequestStates.get(prepared);
}

/**
 * Common shell for executing an Exchange API request:
 * acquires per-`(walletAddress × isTestnet)` lock, generates nonce, calls `build` to construct
 * the signed payload, sends to the Exchange endpoint, and validates the response.
 *
 * The lock covers only nonce issuance and signing, plus request INITIATION (`transport.request`
 * runs synchronously up to its first `await`), so requests are dispatched to the server in
 * strictly increasing nonce order. The lock is released as soon as the request is in flight —
 * network responses resolve concurrently, unblocking order throughput beyond 1/RTT per wallet.
 *
 * @param config Exchange API configuration.
 * @param build Callback that, given the nonce, returns the action, signature, and any extras.
 * @param signal Optional {@link AbortSignal} to cancel the request.
 * @return The validated API response.
 *
 * @throws {ApiRequestError} If the API returns an error response.
 */
export async function executeWithShell<T>(
  config: ExchangeConfig,
  build: (nonce: number) => Promise<BuildResult>,
  signal?: AbortSignal,
): Promise<T> {
  const leader = "wallet" in config ? config.wallet : config.signers[0];
  const walletAddress = await getWalletAddress(leader);

  // Lock per (wallet × testnet) ensures requests are dispatched to the server in nonce order.
  const key = `${walletAddress}:${config.transport.isTestnet}`;
  const box = await withLock(key, async () => {
    // --- Generate nonce --------------------------------------
    const nonce = await (config.nonceManager?.(walletAddress) ?? globalNonceManager.getNonce(key));

    // --- Build signed payload --------------------------------
    const { action, signature, extras } = await build(nonce);

    // --- Initiate the request --------------------------------
    // Hand the pending promise out in a plain (non-thenable) box, so the lock releases
    // without awaiting the network response.
    return {
      pending: config.transport.request<T>(
        "exchange",
        {
          action,
          signature,
          nonce,
          ...extras,
        },
        signal,
      ),
    };
  });

  // --- Await response (concurrently across calls) and validate
  const response = await box.pending;
  assertSuccessResponse(response);
  return response;
}
