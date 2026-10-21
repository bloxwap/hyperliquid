import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request exchange system status information.
 */
export const ExchangeStatusRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("exchangeStatus"),
  });
})();
export type ExchangeStatusRequest = v.InferOutput<typeof ExchangeStatusRequest>;

/**
 * Exchange system status information.
 */
export type ExchangeStatusResponse = {
  /** Server time (in ms since epoch). */
  time: number;
  /** Special statuses of the exchange system. */
  specialStatuses: string | null;
};

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request exchange system status information.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Exchange system status information.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { exchangeStatus } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await exchangeStatus({ transport });
 * ```
 */
export function exchangeStatus(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<ExchangeStatusResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    ExchangeStatusRequest,
    {
      type: "exchangeStatus",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
