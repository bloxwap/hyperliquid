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
