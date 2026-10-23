import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request user abstraction state.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-abstraction-state
 */
export const UserAbstractionRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("userAbstraction"),
    /** User address. */
    user: Address,
  });
})();
export type UserAbstractionRequest = v.InferOutput<typeof UserAbstractionRequest>;

/**
 * User abstraction state.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-abstraction-state
 */
export type UserAbstractionResponse = "unifiedAccount" | "portfolioMargin" | "disabled" | "default" | "dexAbstraction";

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode userAbstraction} function. */
export type UserAbstractionParameters = Omit<v.InferInput<typeof UserAbstractionRequest>, "type">;

/**
 * Request user abstraction state.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return User abstraction state.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userAbstraction } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userAbstraction({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-abstraction-state
 */
export function userAbstraction(
  config: InfoConfig,
  params: UserAbstractionParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<UserAbstractionResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    UserAbstractionRequest,
    {
      type: "userAbstraction",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
