import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import type { PerpDeployAuctionStatusResponse } from "./perpDeployAuctionStatus.ts";

/**
 * Request gossip priority auction status (previous winners and current auctions).
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/priority-fees
 */
export const GossipPriorityAuctionStatusRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("gossipPriorityAuctionStatus"),
  });
})();
export type GossipPriorityAuctionStatusRequest = v.InferOutput<typeof GossipPriorityAuctionStatusRequest>;

/**
 * Gossip priority auction status.
 *
 * A two-element tuple:
 * - `[0]`: previous auction winner IPs per slot (or `null` if no previous winner).
 * - `[1]`: current auction statuses per slot (same shape as {@linkcode PerpDeployAuctionStatusResponse}).
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/priority-fees
 */
export type GossipPriorityAuctionStatusResponse = [
  /** Previous auction winner IPs per slot, or `null` if no previous winner. */
  (`${number}.${number}.${number}.${number}` | null)[],
  /** Current auction statuses per slot. */
  PerpDeployAuctionStatusResponse[],
];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request gossip priority auction status (previous winners and current auctions).
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Gossip priority auction status.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { gossipPriorityAuctionStatus } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await gossipPriorityAuctionStatus({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/priority-fees
 */
export function gossipPriorityAuctionStatus(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<GossipPriorityAuctionStatusResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    GossipPriorityAuctionStatusRequest,
    {
      type: "gossipPriorityAuctionStatus",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
