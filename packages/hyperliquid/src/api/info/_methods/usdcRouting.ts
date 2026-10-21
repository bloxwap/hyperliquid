import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request USDC transfer routing.
 */
export const UsdcRoutingRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("usdcRouting"),
  });
})();
export type UsdcRoutingRequest = v.InferOutput<typeof UsdcRoutingRequest>;

/**
 * Routes currently used to move USDC in and out of the platform.
 */
export type UsdcRoutingResponse = {
  /**
   * Route used for deposits:
   * - `"bridge"`: Hyperliquid USDC bridge.
   * - `"cctp"`: Circle Cross-Chain Transfer Protocol.
   */
  depositRoute: "bridge" | "cctp";
  /**
   * Route used for withdrawals:
   * - `"bridge"`: Hyperliquid USDC bridge.
   * - `"cctp"`: Circle Cross-Chain Transfer Protocol.
   */
  withdrawalRoute: "bridge" | "cctp";
};

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request USDC transfer routing.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Routes currently used to move USDC in and out of the platform.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { usdcRouting } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await usdcRouting({ transport });
 * ```
 */
export function usdcRouting(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<UsdcRoutingResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    UsdcRoutingRequest,
    {
      type: "usdcRouting",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
