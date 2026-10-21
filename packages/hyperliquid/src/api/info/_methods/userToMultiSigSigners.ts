import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request multi-sig signers for a user.
 */
export const UserToMultiSigSignersRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("userToMultiSigSigners"),
    /** User address. */
    user: Address,
  });
})();
export type UserToMultiSigSignersRequest = v.InferOutput<typeof UserToMultiSigSignersRequest>;

/**
 * Multi-sig signers for a user or null if the user does not have any multi-sig signers.
 */
export type UserToMultiSigSignersResponse = {
  /**
   * Authorized users addresses.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  authorizedUsers: `0x${string}`[];
  /** Threshold number of signatures required. */
  threshold: number;
} | null;

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode userToMultiSigSigners} function. */
export type UserToMultiSigSignersParameters = Omit<v.InferInput<typeof UserToMultiSigSignersRequest>, "type">;

/**
 * Request multi-sig signers for a user.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Multi-sig signers for a user or null if the user does not have any multi-sig signers.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userToMultiSigSigners } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userToMultiSigSigners({ transport }, {
 *   user: "0x...",
 * });
 * ```
 */
export function userToMultiSigSigners(
  config: InfoConfig,
  params: UserToMultiSigSignersParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<UserToMultiSigSignersResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    UserToMultiSigSignersRequest,
    {
      type: "userToMultiSigSigners",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
