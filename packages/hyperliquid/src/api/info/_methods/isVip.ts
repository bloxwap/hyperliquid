import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request to check if a user is a VIP.
 */
export const IsVipRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("isVip"),
    /** User address. */
    user: Address,
  });
})();
export type IsVipRequest = v.InferOutput<typeof IsVipRequest>;

/**
 * Boolean indicating user's VIP status.
 */
export type IsVipResponse = boolean | null;

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode isVip} function. */
export type IsVipParameters = Omit<v.InferInput<typeof IsVipRequest>, "type">;

/**
 * Request to check if a user is a VIP.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Boolean indicating user's VIP status.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { isVip } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await isVip({ transport }, {
 *   user: "0x...",
 * });
 * ```
 */
export function isVip(
  config: InfoConfig,
  params: IsVipParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<IsVipResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    IsVipRequest,
    {
      type: "isVip",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
