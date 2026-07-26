// ============================================================
// Execution Logic
// ============================================================

import type { ExchangeConfig, PreparedExchangeRequest } from "./_base/mod.ts";
import { assertSuccessResponse } from "./_base/errors.ts";

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
 * @param config General configuration for Exchange API requests.
 * @param prepared The signed request payload returned by {@linkcode prepareRequest}.
 * @param opts Request execution options.
 * @return The API response.
 *
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
export async function submitPrepared<T = unknown>(
  config: ExchangeConfig,
  prepared: PreparedExchangeRequest,
  opts?: SubmitPreparedOptions,
): Promise<T> {
  const response = await config.transport.request<T>("exchange", prepared, opts?.signal);
  assertSuccessResponse(response);
  return response;
}
