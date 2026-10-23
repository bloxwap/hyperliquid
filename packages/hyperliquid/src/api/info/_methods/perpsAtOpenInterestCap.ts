import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request perpetuals at open interest cap.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#query-perps-at-open-interest-caps
 */
export const PerpsAtOpenInterestCapRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("perpsAtOpenInterestCap"),
    /** DEX name (empty string for main dex). */
    dex: v.optional(v.string()),
  });
})();
export type PerpsAtOpenInterestCapRequest = v.InferOutput<typeof PerpsAtOpenInterestCapRequest>;

/**
 * Array of perpetuals at open interest caps.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#query-perps-at-open-interest-caps
 */
export type PerpsAtOpenInterestCapResponse = string[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, isAbortSignal, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode perpsAtOpenInterestCap} function. */
export type PerpsAtOpenInterestCapParameters = Omit<v.InferInput<typeof PerpsAtOpenInterestCapRequest>, "type">;

/**
 * Request perpetuals at open interest cap.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of perpetuals at open interest caps.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { perpsAtOpenInterestCap } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await perpsAtOpenInterestCap({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#query-perps-at-open-interest-caps
 */
export function perpsAtOpenInterestCap(
  config: InfoConfig,
  params?: PerpsAtOpenInterestCapParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PerpsAtOpenInterestCapResponse>;
export function perpsAtOpenInterestCap(
  config: InfoConfig,
  signal?: AbortSignal,
): Promise<PerpsAtOpenInterestCapResponse>;
export function perpsAtOpenInterestCap(
  config: InfoConfig,
  paramsOrSignal?: PerpsAtOpenInterestCapParameters | AbortSignal,
  maybeSignalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PerpsAtOpenInterestCapResponse> {
  const params = isAbortSignal(paramsOrSignal) ? {} : paramsOrSignal;
  const { signal, skipValidation } = infoOptions(isAbortSignal(paramsOrSignal) ? paramsOrSignal : maybeSignalOrOptions);

  const request = parseInfo(
    PerpsAtOpenInterestCapRequest,
    {
      type: "perpsAtOpenInterestCap",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
