import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request user HIP-3 DEX abstraction state.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-hip-3-dex-abstraction-state
 */
export const UserDexAbstractionRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("userDexAbstraction"),
    /** User address. */
    user: Address,
  });
})();
export type UserDexAbstractionRequest = v.InferOutput<typeof UserDexAbstractionRequest>;

/**
 * User HIP-3 DEX abstraction state.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-hip-3-dex-abstraction-state
 */
export type UserDexAbstractionResponse = boolean | null;

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode userDexAbstraction} function. */
export type UserDexAbstractionParameters = Omit<v.InferInput<typeof UserDexAbstractionRequest>, "type">;

/**
 * Request user HIP-3 DEX abstraction state.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return User HIP-3 DEX abstraction state.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userDexAbstraction } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userDexAbstraction({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-hip-3-dex-abstraction-state
 */
export function userDexAbstraction(
  config: InfoConfig,
  params: UserDexAbstractionParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<UserDexAbstractionResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    UserDexAbstractionRequest,
    {
      type: "userDexAbstraction",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
