import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request for the status of the perpetual deploy auction.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-information-about-the-perp-deploy-auction
 */
export const PerpDeployAuctionStatusRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("perpDeployAuctionStatus"),
  });
})();
export type PerpDeployAuctionStatusRequest = v.InferOutput<typeof PerpDeployAuctionStatusRequest>;

/**
 * Status of the perpetual deploy auction.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-information-about-the-perp-deploy-auction
 */
export type PerpDeployAuctionStatusResponse = {
  /**
   * Current gas.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  currentGas: string | null;
  /** Duration in seconds. */
  durationSeconds: number;
  /**
   * Ending gas.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  endGas: string | null;
  /**
   * Starting gas.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  startGas: string;
  /** Auction start time (in seconds since epoch). */
  startTimeSeconds: number;
};

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request for the status of the perpetual deploy auction.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Status of the perpetual deploy auction.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { perpDeployAuctionStatus } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await perpDeployAuctionStatus({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-information-about-the-perp-deploy-auction
 */
export function perpDeployAuctionStatus(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PerpDeployAuctionStatusResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    PerpDeployAuctionStatusRequest,
    {
      type: "perpDeployAuctionStatus",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
