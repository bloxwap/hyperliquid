import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request perp DEX status.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#get-perp-market-status
 */
export const PerpDexStatusRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("perpDexStatus"),
    /** Perp dex name of builder-deployed dex market. The empty string represents the first perp dex. */
    dex: v.string(),
  });
})();
export type PerpDexStatusRequest = v.InferOutput<typeof PerpDexStatusRequest>;

/**
 * Status of a perp DEX.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#get-perp-market-status
 */
export type PerpDexStatusResponse = {
  /**
   * Total net deposit.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  totalNetDeposit: string;
};

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode perpDexStatus} function. */
export type PerpDexStatusParameters = Omit<v.InferInput<typeof PerpDexStatusRequest>, "type">;

/**
 * Request perp DEX status.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Status of a perp DEX.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { perpDexStatus } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await perpDexStatus({ transport }, {
 *   dex: "test",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#get-perp-market-status
 */
export function perpDexStatus(
  config: InfoConfig,
  params: PerpDexStatusParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PerpDexStatusResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    PerpDexStatusRequest,
    {
      type: "perpDexStatus",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
