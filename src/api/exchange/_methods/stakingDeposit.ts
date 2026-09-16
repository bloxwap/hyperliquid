/**
 * Friendly-named alias for {@linkcode cDeposit}.
 * @module
 */

import type { ExchangeConfig } from "./_base/mod.ts";
import { type CDepositOptions, type CDepositParameters, type CDepositSuccessResponse, cDeposit } from "./cDeposit.ts";

/** Action parameters for the {@linkcode stakingDeposit} function. */
export type StakingDepositParameters = CDepositParameters;

/** Request options for the {@linkcode stakingDeposit} function. */
export type StakingDepositOptions = CDepositOptions;

/** Successful variant of the staking deposit response without errors. */
export type StakingDepositSuccessResponse = CDepositSuccessResponse;

/**
 * Transfer native token from the user spot account into staking for delegating to validators.
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
 * import { stakingDeposit } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await stakingDeposit({ transport, wallet }, {
 *   wei: 1 * 1e8,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#deposit-into-staking
 */
export function stakingDeposit(
  config: ExchangeConfig,
  params: StakingDepositParameters,
  opts?: StakingDepositOptions,
): Promise<StakingDepositSuccessResponse> {
  return cDeposit(config, params, opts);
}
