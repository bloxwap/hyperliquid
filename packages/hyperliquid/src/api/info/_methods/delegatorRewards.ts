import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request user staking rewards.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-staking-rewards
 */
export const DelegatorRewardsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("delegatorRewards"),
    /** User address. */
    user: Address,
  });
})();
export type DelegatorRewardsRequest = v.InferOutput<typeof DelegatorRewardsRequest>;

/**
 * Array of rewards received from staking activities.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-staking-rewards
 */
export type DelegatorRewardsResponse = {
  /** Timestamp when the reward was received (in ms since epoch). */
  time: number;
  /** Source of the reward. */
  source: "delegation" | "commission";
  /**
   * Total reward amount.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  totalAmount: string;
}[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode delegatorRewards} function. */
export type DelegatorRewardsParameters = Omit<v.InferInput<typeof DelegatorRewardsRequest>, "type">;

/**
 * Request user staking rewards.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of rewards received from staking activities.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { delegatorRewards } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await delegatorRewards({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-staking-rewards
 */
export function delegatorRewards(
  config: InfoConfig,
  params: DelegatorRewardsParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<DelegatorRewardsResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    DelegatorRewardsRequest,
    {
      type: "delegatorRewards",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
