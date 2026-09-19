/**
 * Friendly-named alias for {@linkcode cSignerAction}.
 * @module
 */

import type { ExchangeConfig } from "./_base/mod.ts";
import {
  type CSignerActionOptions,
  type CSignerActionParameters,
  type CSignerActionSuccessResponse,
  cSignerAction,
} from "./cSignerAction.ts";

/** Action parameters for the {@linkcode validatorSignerAction} function. */
export type ValidatorSignerActionParameters = CSignerActionParameters;

/** Request options for the {@linkcode validatorSignerAction} function. */
export type ValidatorSignerActionOptions = CSignerActionOptions;

/** Successful variant of the validator signer action response without errors. */
export type ValidatorSignerActionSuccessResponse = CSignerActionSuccessResponse;

/**
 * Jail or unjail self as a validator signer.
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
 * @example Jail self
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { validatorSignerAction } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await validatorSignerAction({ transport, wallet }, {
 *   jailSelf: null,
 * });
 * ```
 *
 * @example Unjail self
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { validatorSignerAction } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await validatorSignerAction({ transport, wallet }, {
 *   unjailSelf: null,
 * });
 * ```
 */
export function validatorSignerAction(
  config: ExchangeConfig,
  params: ValidatorSignerActionParameters,
  opts?: ValidatorSignerActionOptions,
): Promise<ValidatorSignerActionSuccessResponse> {
  return cSignerAction(config, params, opts);
}
