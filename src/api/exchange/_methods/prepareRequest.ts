// ============================================================
// Execution Logic
// ============================================================

import { HyperliquidError } from "../../../_base.ts";
import type { IRequestTransport } from "../../../transport/mod.ts";
import type { ExchangeConfig, PreparedExchangeRequest } from "./_base/mod.ts";

export type { PreparedExchangeRequest } from "./_base/mod.ts";

/**
 * Success stub handed to the method being prepared: responses are not validated, and the shell
 * only checks for error shapes, so a minimal `ok` envelope lets every method run to completion
 * while its real request is captured instead of posted.
 */
const CAPTURE_SUCCESS = { status: "ok", response: { type: "default" } } as const;

/**
 * Build a fully signed Exchange request without sending it (sign now, submit later).
 *
 * Runs `run` against a capture transport: the callback executes any Exchange method exactly as
 * usual (validation, nonce issuance, signing), but the resulting request is captured instead of
 * being posted. The returned payload can be submitted later with {@linkcode submitPrepared} —
 * useful for latency-critical flows (e.g. a pre-signed cancel-all fired with zero signing latency).
 *
 * The nonce is consumed at prepare time: it is fresh and monotonic when the payload is signed.
 * **A prepared payload goes stale if another request from the same wallet consumes a later nonce
 * first** — the server rejects nonces less than or equal to the last one it saw, so submit a
 * prepared payload before issuing newer requests (or accept that it may be rejected as stale).
 *
 * The callback must issue exactly one request (one Exchange method call).
 *
 * @param config General configuration for Exchange API requests.
 * @param run Callback that issues one Exchange API request (e.g. `(config) => order(config, params)`).
 * @return The signed request payload (`{ action, signature, nonce, ... }`), ready for {@linkcode submitPrepared}.
 *
 * @throws {ValidationError} When the request parameters fail validation (before signing).
 * @throws {HyperliquidError} When the callback issues zero or more than one request.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { order, prepareRequest } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const prepared = await prepareRequest({ transport, wallet }, (config) =>
 *   order(config, {
 *     orders: [{ a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }],
 *     grouping: "na",
 *   }),
 * );
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets#hyperliquid-nonces
 */
export async function prepareRequest(
  config: ExchangeConfig,
  run: (config: ExchangeConfig) => Promise<unknown>,
): Promise<PreparedExchangeRequest> {
  let captured: PreparedExchangeRequest | undefined;
  const capture: IRequestTransport = {
    isTestnet: config.transport.isTestnet,
    request<T>(_endpoint: "info" | "exchange", payload: unknown, _signal?: AbortSignal): Promise<T> {
      if (captured !== undefined) {
        return Promise.reject(new HyperliquidError("prepareRequest: the callback issued more than one request"));
      }
      captured = payload as PreparedExchangeRequest;
      return Promise.resolve(CAPTURE_SUCCESS as T);
    },
  };

  await run({ ...config, transport: capture });

  if (captured === undefined) {
    throw new HyperliquidError("prepareRequest: the callback did not issue a request");
  }
  // The shell spreads `vaultAddress`/`expiresAfter` into the payload even when unset; drop the
  // undefined keys so the prepared payload is exactly what goes over the wire (JSON transports
  // omit undefined), and so it survives a `JSON.stringify` round trip unchanged.
  if (captured.vaultAddress === undefined) delete captured.vaultAddress;
  if (captured.expiresAfter === undefined) delete captured.expiresAfter;
  return captured;
}
