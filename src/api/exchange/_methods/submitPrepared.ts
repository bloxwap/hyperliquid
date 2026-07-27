// ============================================================
// Execution Logic
// ============================================================

import { HyperliquidError } from "../../../_base.ts";
import type { ExchangeConfig, PreparedExchangeRequest } from "./_base/mod.ts";
import { assertSuccessResponse } from "./_base/errors.ts";
import { getPreparedRequestState } from "./_base/_shell.ts";

/** Request options for the {@linkcode submitPrepared} function. */
export interface SubmitPreparedOptions {
  /** {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request. */
  signal?: AbortSignal;
}

/**
 * Submit a previously prepared (signed) Exchange request.
 *
 * Posts a payload built by {@linkcode prepareRequest} to the Exchange endpoint as-is: no
 * re-validation, no re-signing, no nonce refresh. The payload must be submitted through the same
 * network (testnet vs mainnet) it was signed for — the signature commits to it.
 *
 * If the prepare callback leaked a request attempt that began after `prepareRequest` returned,
 * the payload is poisoned (best-effort, in-process guard) and submission rejects with a
 * `HyperliquidError` — discard it and prepare again. The poison re-check is a point-in-time
 * check immediately before posting, not a happens-before guarantee.
 *
 * @param config General configuration for Exchange API requests.
 * @param prepared The signed request payload returned by {@linkcode prepareRequest}.
 * @param opts Request execution options.
 * @return The API response.
 *
 * @throws {HyperliquidError} When the payload was poisoned by a request attempted after it was produced.
 * @throws {TransportError} When the transport layer throws an error.
 * @throws {ApiRequestError} When the API returns an unsuccessful response (e.g. a stale nonce).
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { submitPrepared } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await submitPrepared({ transport, wallet }, prepared);
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint
 */
export async function submitPrepared<T>(
  config: ExchangeConfig,
  prepared: PreparedExchangeRequest<T>,
  opts?: SubmitPreparedOptions,
): Promise<T> {
  // Re-check the poison state synchronously, immediately before posting: a request attempted
  // (via the capture transport) after the payload was produced invalidates it, even though the
  // payload itself looks fine. This is a point-in-time check, not a happens-before guarantee:
  // an attempt landing after this line but before or during the post below is not caught —
  // closing that window would require serializing submission against leaked callback work,
  // which is deliberately out of scope (best-effort guard).
  const state = getPreparedRequestState(prepared);
  if (state !== undefined && state.invalidAttempts > 0) {
    throw new HyperliquidError(
      "submitPrepared: the payload was poisoned by a request attempted after it was produced; discard it and prepare again",
    );
  }
  const response = await config.transport.request<T>("exchange", prepared, opts?.signal);
  assertSuccessResponse(response);
  return response;
}
