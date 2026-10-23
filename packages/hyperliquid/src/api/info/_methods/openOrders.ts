import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";
import type { OpenOrder } from "./_base/mod.ts";

/**
 * Request open orders.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders
 */
export const OpenOrdersRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("openOrders"),
    /** User address. */
    user: Address,
    /** DEX name (empty string for main dex). */
    dex: v.optional(v.string()),
  });
})();
export type OpenOrdersRequest = v.InferOutput<typeof OpenOrdersRequest>;

/**
 * Array of open orders.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders
 */
export type OpenOrdersResponse = OpenOrder[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode openOrders} function. */
export type OpenOrdersParameters = Omit<v.InferInput<typeof OpenOrdersRequest>, "type">;

/**
 * Request open orders.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of open orders.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { openOrders } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await openOrders({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders
 */
export function openOrders(
  config: InfoConfig,
  params: OpenOrdersParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<OpenOrdersResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    OpenOrdersRequest,
    {
      type: "openOrders",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
