import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request builder fee approval.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#check-builder-fee-approval
 */
export const MaxBuilderFeeRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("maxBuilderFee"),
    /** User address. */
    user: Address,
    /** Builder address. */
    builder: Address,
  });
})();

export type MaxBuilderFeeRequest = v.InferOutput<typeof MaxBuilderFeeRequest>;

/**
 * Maximum builder fee approval.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#check-builder-fee-approval
 */
export type MaxBuilderFeeResponse = number;

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode maxBuilderFee} function. */
export type MaxBuilderFeeParameters = Omit<v.InferInput<typeof MaxBuilderFeeRequest>, "type">;

/**
 * Request builder fee approval.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Maximum builder fee approval.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { maxBuilderFee } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await maxBuilderFee({ transport }, {
 *   user: "0x...",
 *   builder: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#check-builder-fee-approval
 */
export function maxBuilderFee(
  config: InfoConfig,
  params: MaxBuilderFeeParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<MaxBuilderFeeResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    MaxBuilderFeeRequest,
    {
      type: "maxBuilderFee",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
