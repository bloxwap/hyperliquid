import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request all perpetual asset categories.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perp-categories
 */
export const PerpCategoriesRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("perpCategories"),
  });
})();
export type PerpCategoriesRequest = v.InferOutput<typeof PerpCategoriesRequest>;

/**
 * Array of tuples mapping coin names to their categories.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perp-categories
 */
export type PerpCategoriesResponse = [
  /** Asset symbol (e.g., BTC). */
  coin: string,
  /** Category name. */
  category: string,
][];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request all perpetual asset categories.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of tuples mapping coin names to their categories.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { perpCategories } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await perpCategories({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perp-categories
 */
export function perpCategories(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PerpCategoriesResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    PerpCategoriesRequest,
    {
      type: "perpCategories",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
