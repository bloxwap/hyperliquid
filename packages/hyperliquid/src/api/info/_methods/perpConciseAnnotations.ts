import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request concise annotations for all perpetual assets.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-concise-perp-annotations
 */
export const PerpConciseAnnotationsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("perpConciseAnnotations"),
  });
})();
export type PerpConciseAnnotationsRequest = v.InferOutput<typeof PerpConciseAnnotationsRequest>;

/**
 * Array of tuples mapping coin names to their concise annotations.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-concise-perp-annotations
 */
export type PerpConciseAnnotationsResponse = [
  /** Asset symbol (e.g., BTC). */
  coin: string,
  /** Concise annotation. */
  annotation: {
    /** Classification category assigned to the perpetual. */
    category: string;
    /** Display name for frontends to use instead of the L1 name. */
    displayName?: string;
    /** Keywords used as hints to match against searches. */
    keywords?: string[];
  },
][];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request concise annotations for all perpetual assets.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of tuples mapping coin names to their concise annotations.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { perpConciseAnnotations } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await perpConciseAnnotations({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-concise-perp-annotations
 */
export function perpConciseAnnotations(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PerpConciseAnnotationsResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    PerpConciseAnnotationsRequest,
    {
      type: "perpConciseAnnotations",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
