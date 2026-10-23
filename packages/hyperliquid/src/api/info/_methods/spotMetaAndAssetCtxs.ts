import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import type { SpotAssetCtx } from "./_base/mod.ts";
import type { SpotMetaResponse } from "./spotMeta.ts";

/**
 * Request spot metadata and asset contexts.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-spot-asset-contexts
 */
export const SpotMetaAndAssetCtxsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("spotMetaAndAssetCtxs"),
  });
})();
export type SpotMetaAndAssetCtxsRequest = v.InferOutput<typeof SpotMetaAndAssetCtxsRequest>;

/**
 * Tuple of spot metadata and asset contexts.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-spot-asset-contexts
 */
export type SpotMetaAndAssetCtxsResponse = [
  /** Spot metadata. */
  meta: SpotMetaResponse,
  /** Asset contexts. */
  assetCtxs: SpotAssetCtx[],
];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request spot metadata and asset contexts.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Metadata and context for spot assets.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { spotMetaAndAssetCtxs } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await spotMetaAndAssetCtxs({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-spot-asset-contexts
 */
export function spotMetaAndAssetCtxs(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<SpotMetaAndAssetCtxsResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    SpotMetaAndAssetCtxsRequest,
    {
      type: "spotMetaAndAssetCtxs",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
