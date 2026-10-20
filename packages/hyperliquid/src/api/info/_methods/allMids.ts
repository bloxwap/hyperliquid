import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request mid coin prices.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-mids-for-all-coins
 */
export const AllMidsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("allMids"),
    /** DEX name (empty string for main dex). */
    dex: v.optional(v.string()),
  });
})();
export type AllMidsRequest = v.InferOutput<typeof AllMidsRequest>;

/**
 * Mapping of coin symbols to mid prices.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-mids-for-all-coins
 */
export type AllMidsResponse = {
  /**
   * Mid price.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  [x: string]: string;
};

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, isAbortSignal, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode allMids} function. */
export type AllMidsParameters = Omit<v.InferInput<typeof AllMidsRequest>, "type">;

/**
 * Request mid coin prices.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Mapping of coin symbols to mid prices.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { allMids } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await allMids({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-mids-for-all-coins
 */
export function allMids(
  config: InfoConfig,
  params?: AllMidsParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<AllMidsResponse>;
export function allMids(config: InfoConfig, signal?: AbortSignal): Promise<AllMidsResponse>;
export function allMids(
  config: InfoConfig,
  paramsOrSignal?: AllMidsParameters | AbortSignal,
  maybeSignalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<AllMidsResponse> {
  const params = isAbortSignal(paramsOrSignal) ? {} : paramsOrSignal;
  const { signal, skipValidation } = infoOptions(isAbortSignal(paramsOrSignal) ? paramsOrSignal : maybeSignalOrOptions);

  const request = parseInfo(
    AllMidsRequest,
    {
      type: "allMids",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
