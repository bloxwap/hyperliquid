import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";
import type { FrontendOpenOrder } from "./_base/mod.ts";

/**
 * Request frontend open orders.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders-with-additional-frontend-info
 */
export const FrontendOpenOrdersRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("frontendOpenOrders"),
    /** User address. */
    user: Address,
    /** DEX name (empty string for main dex). */
    dex: v.optional(v.string()),
  });
})();
export type FrontendOpenOrdersRequest = v.InferOutput<typeof FrontendOpenOrdersRequest>;

/**
 * Array of open orders with additional display information.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders-with-additional-frontend-info
 */
export type FrontendOpenOrdersResponse = FrontendOpenOrder[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode frontendOpenOrders} function. */
export type FrontendOpenOrdersParameters = Omit<v.InferInput<typeof FrontendOpenOrdersRequest>, "type">;

/**
 * Request frontend open orders.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of open orders with additional display information.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { frontendOpenOrders } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await frontendOpenOrders({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders-with-additional-frontend-info
 */
export function frontendOpenOrders(
  config: InfoConfig,
  params: FrontendOpenOrdersParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<FrontendOpenOrdersResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    FrontendOpenOrdersRequest,
    {
      type: "frontendOpenOrders",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
