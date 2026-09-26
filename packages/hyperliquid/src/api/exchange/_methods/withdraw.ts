/**
 * Friendly-named alias for {@linkcode withdraw3}.
 * @module
 */

import type { ExchangeConfig } from "./_base/mod.ts";
import {
  type Withdraw3Options,
  type Withdraw3Parameters,
  type Withdraw3SuccessResponse,
  withdraw3,
} from "./withdraw3.ts";

/** Action parameters for the {@linkcode withdraw} function. */
export type WithdrawParameters = Withdraw3Parameters;

/** Request options for the {@linkcode withdraw} function. */
export type WithdrawOptions = Withdraw3Options;

/** Successful variant of the withdrawal response without errors. */
export type WithdrawSuccessResponse = Withdraw3SuccessResponse;

/**
 * Initiate a withdrawal request.
 *
 * Signing: User-Signed EIP-712.
 *
 * @param config General configuration for Exchange API requests.
 * @param params Parameters specific to the API request.
 * @param opts Request execution options.
 * @return Successful response without specific data.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 * @throws {ApiRequestError} When the API returns an unsuccessful response.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { withdraw } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await withdraw({ transport, wallet }, {
 *   destination: "0x...",
 *   amount: "1",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#initiate-a-withdrawal-request
 */
export function withdraw(
  config: ExchangeConfig,
  params: WithdrawParameters,
  opts?: WithdrawOptions,
): Promise<WithdrawSuccessResponse> {
  return withdraw3(config, params, opts);
}
