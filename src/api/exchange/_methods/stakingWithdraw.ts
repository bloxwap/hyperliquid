/**
 * Friendly-named alias for {@linkcode cWithdraw}.
 * @module
 */

import type { ExchangeConfig } from "./_base/mod.ts";
import {
  type CWithdrawOptions,
  type CWithdrawParameters,
  type CWithdrawSuccessResponse,
  cWithdraw,
} from "./cWithdraw.ts";

/** Action parameters for the {@linkcode stakingWithdraw} function. */
export type StakingWithdrawParameters = CWithdrawParameters;

/** Request options for the {@linkcode stakingWithdraw} function. */
export type StakingWithdrawOptions = CWithdrawOptions;

/** Successful variant of the staking withdrawal response without errors. */
export type StakingWithdrawSuccessResponse = CWithdrawSuccessResponse;

/**
 * Transfer native token from staking into the user's spot account.
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
 * import { stakingWithdraw } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await stakingWithdraw({ transport, wallet }, {
 *   wei: 1 * 1e8,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#withdraw-from-staking
 */
export function stakingWithdraw(
  config: ExchangeConfig,
  params: StakingWithdrawParameters,
  opts?: StakingWithdrawOptions,
): Promise<StakingWithdrawSuccessResponse> {
  return cWithdraw(config, params, opts);
}
