import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request gossip root IPs.
 */
export const GossipRootIpsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("gossipRootIps"),
  });
})();
export type GossipRootIpsRequest = v.InferOutput<typeof GossipRootIpsRequest>;

/**
 * Array of gossip root IPs.
 */
export type GossipRootIpsResponse = `${number}.${number}.${number}.${number}`[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request gossip root IPs.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of gossip root IPs.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { gossipRootIps } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await gossipRootIps({ transport });
 * ```
 */
export function gossipRootIps(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<GossipRootIpsResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    GossipRootIpsRequest,
    {
      type: "gossipRootIps",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
