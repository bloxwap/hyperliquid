import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request maximum market order notionals.
 */
export const MaxMarketOrderNtlsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("maxMarketOrderNtls"),
  });
})();
export type MaxMarketOrderNtlsRequest = v.InferOutput<typeof MaxMarketOrderNtlsRequest>;

/**
 * Array of tuples of maximum leverage and its corresponding maximum market order notional.
 */
export type MaxMarketOrderNtlsResponse = [
  /** Maximum leverage. */
  maxLeverage: number,
  /**
   * Maximum market order notional.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  maxMarketOrderNtl: string,
][];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request maximum market order notionals.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Maximum market order notionals.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { maxMarketOrderNtls } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await maxMarketOrderNtls({ transport });
 * ```
 */
export function maxMarketOrderNtls(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<MaxMarketOrderNtlsResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    MaxMarketOrderNtlsRequest,
    {
      type: "maxMarketOrderNtls",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
