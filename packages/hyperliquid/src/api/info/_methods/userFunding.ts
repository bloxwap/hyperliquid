import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address, UnsignedInteger } from "../../_schemas.ts";

/**
 * Request array of user funding ledger updates.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
 */
export const UserFundingRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("userFunding"),
    /** User address. */
    user: Address,
    /** Start time (in ms since epoch). */
    startTime: v.nullish(UnsignedInteger),
    /** End time (in ms since epoch). */
    endTime: v.nullish(UnsignedInteger),
  });
})();
export type UserFundingRequest = v.InferOutput<typeof UserFundingRequest>;

/**
 * Array of user funding ledger updates.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
 */
export type UserFundingResponse = {
  /** Timestamp of the update (in ms since epoch). */
  time: number;
  /**
   * L1 transaction hash.
   * @pattern ^0x[a-fA-F0-9]{64}$
   */
  hash: `0x${string}`;
  /** Update details. */
  delta: {
    /** Update type. */
    type: "funding";
    /** Asset symbol (e.g., BTC). */
    coin: string;
    /**
     * Amount transferred in USDC.
     * @pattern ^-?[0-9]+(\.[0-9]+)?$
     */
    usdc: string;
    /**
     * Signed position size.
     * @pattern ^-?[0-9]+(\.[0-9]+)?$
     */
    szi: string;
    /**
     * Applied funding rate.
     * @pattern ^-?[0-9]+(\.[0-9]+)?$
     */
    fundingRate: string;
    /** Number of samples. */
    nSamples: number | null;
  };
}[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode userFunding} function. */
export type UserFundingParameters = Omit<v.InferInput<typeof UserFundingRequest>, "type">;

/**
 * Request array of user funding ledger updates.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of user funding ledger updates.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userFunding } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userFunding({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
 */
export function userFunding(
  config: InfoConfig,
  params: UserFundingParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<UserFundingResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    UserFundingRequest,
    {
      type: "userFunding",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
