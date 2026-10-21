// ============================================================
// Execution Logic
// ============================================================

import type { InfoConfig, InfoRequestOptions } from "./_base/mod.ts";
import { subAccounts2, type SubAccounts2Parameters, type SubAccounts2Response } from "./subAccounts2.ts";

/** Request parameters for the {@linkcode subAccountsV2} function. */
export type SubAccountsV2Parameters = SubAccounts2Parameters;

/** Response of the {@linkcode subAccountsV2} function. */
export type SubAccountsV2Response = SubAccounts2Response;

/**
 * Request user sub-accounts V2.
 *
 * Friendly alias of {@linkcode subAccounts2} (the wire name): sends the same `subAccounts2`
 * request and returns its response unchanged.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of user sub-account or null if the user does not have any sub-accounts.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { subAccountsV2 } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await subAccountsV2({ transport }, {
 *   user: "0x...",
 * });
 * ```
 */
export function subAccountsV2(
  config: InfoConfig,
  params: SubAccountsV2Parameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<SubAccountsV2Response> {
  return subAccounts2(config, params, signalOrOptions);
}
