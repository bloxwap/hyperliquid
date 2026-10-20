import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import type { MetaResponse } from "./meta.ts";

/**
 * Request trading metadata for all DEXs.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-all-perpetuals-metadata-universe-and-margin-tables
 */
export const AllPerpMetasRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("allPerpMetas"),
  });
})();
export type AllPerpMetasRequest = v.InferOutput<typeof AllPerpMetasRequest>;

/**
 * Metadata for perpetual assets across all DEXs.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-all-perpetuals-metadata-universe-and-margin-tables
 */
export type AllPerpMetasResponse = MetaResponse[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request trading metadata for all DEXs.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Metadata for perpetual assets across all DEXs.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { allPerpMetas } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await allPerpMetas({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-all-perpetuals-metadata-universe-and-margin-tables
 */
export function allPerpMetas(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<AllPerpMetasResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    AllPerpMetasRequest,
    {
      type: "allPerpMetas",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
