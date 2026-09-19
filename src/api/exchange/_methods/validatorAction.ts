/**
 * Friendly-named alias for {@linkcode cValidatorAction}.
 * @module
 */

import type { ExchangeConfig } from "./_base/mod.ts";
import {
  type CValidatorActionOptions,
  type CValidatorActionParameters,
  type CValidatorActionSuccessResponse,
  cValidatorAction,
} from "./cValidatorAction.ts";

/** Action parameters for the {@linkcode validatorAction} function. */
export type ValidatorActionParameters = CValidatorActionParameters;

/** Request options for the {@linkcode validatorAction} function. */
export type ValidatorActionOptions = CValidatorActionOptions;

/** Successful variant of the validator action response without errors. */
export type ValidatorActionSuccessResponse = CValidatorActionSuccessResponse;

/**
 * Action related to validator management.
 *
 * Signing: L1 Action.
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
 * @example Change validator profile
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { validatorAction } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await validatorAction({ transport, wallet }, {
 *   changeProfile: {
 *     node_ip: { Ip: "1.2.3.4" },
 *     name: "...",
 *     description: "...",
 *     unjailed: true,
 *     disable_delegations: false,
 *     commission_bps: null,
 *     signer: null,
 *   },
 * });
 * ```
 */
export function validatorAction(
  config: ExchangeConfig,
  params: ValidatorActionParameters,
  opts?: ValidatorActionOptions,
): Promise<ValidatorActionSuccessResponse> {
  return cValidatorAction(config, params, opts);
}
