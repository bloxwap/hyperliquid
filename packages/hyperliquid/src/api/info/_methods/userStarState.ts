import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request user HIP-3* approval state (testnet only).
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions#user-star-state
 */
export const UserStarStateRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("userStarState"),
    /** User address. */
    user: Address,
  });
})();
export type UserStarStateRequest = v.InferOutput<typeof UserStarStateRequest>;

/**
 * User HIP-3* approval state.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions#user-star-state
 */
export type UserStarStateResponse = {
  /** Venue/state tuples as returned by live servers; null means approval was removed. */
  dexToState: [
    dex: string,
    state: {
      /** Whether the user is restricted to reduce-only trading. */
      isReduceOnly: boolean;
      /** Whether the user can deposit into/withdraw from the backstop liquidator. */
      isBackstopLiquidatorDepositAllowed: boolean;
    } | null,
  ][];
};

// ============================================================
// Execution Logic
// ============================================================

import { parse } from "../../../_base.ts";
import type { InfoConfig } from "./_base/mod.ts";

/** Request parameters for the {@linkcode userStarState} function. */
export type UserStarStateParameters = Omit<v.InferInput<typeof UserStarStateRequest>, "type">;

/**
 * Request user HIP-3* approval state (testnet only).
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return User HIP-3* approval state.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userStarState } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userStarState({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions#user-star-state
 */
export function userStarState(
  config: InfoConfig,
  params: UserStarStateParameters,
  signal?: AbortSignal,
): Promise<UserStarStateResponse> {
  const request = parse(UserStarStateRequest, {
    type: "userStarState",
    ...params,
  });
  return config.transport.request("info", request, signal);
}
