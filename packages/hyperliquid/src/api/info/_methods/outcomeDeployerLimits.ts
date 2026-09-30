import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request the remaining outcome deployment capacity for a venue.
 */
export const OutcomeDeployerLimitsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("outcomeDeployerLimits"),
    /** Outcome venue name. */
    venue: v.pipe(v.string(), v.minLength(1)),
  });
})();

export type OutcomeDeployerLimitsRequest = v.InferOutput<typeof OutcomeDeployerLimitsRequest>;

/**
 * Remaining daily and active outcome deployment capacity.
 */
export type OutcomeDeployerLimitsResponse = {
  /** Outcomes that can still be deployed today. */
  nDailyOutcomesRemaining: number;
  /** Outcomes that can still be active at the same time. */
  nActiveOutcomesRemaining: number;
};

// ============================================================
// Execution Logic
// ============================================================

import { parse } from "../../../_base.ts";
import type { InfoConfig } from "./_base/mod.ts";

/** Request parameters for the {@linkcode outcomeDeployerLimits} function. */
export type OutcomeDeployerLimitsParameters = Omit<v.InferInput<typeof OutcomeDeployerLimitsRequest>, "type">;

/**
 * Request the remaining outcome deployment capacity for a venue.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Remaining daily and active outcome deployment capacity.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-outcome-deployer-limits
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { outcomeDeployerLimits } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await outcomeDeployerLimits({ transport }, {
 *   venue: "ab",
 * });
 * ```
 */
export function outcomeDeployerLimits(
  config: InfoConfig,
  params: OutcomeDeployerLimitsParameters,
  signal?: AbortSignal,
): Promise<OutcomeDeployerLimitsResponse> {
  const request = parse(OutcomeDeployerLimitsRequest, {
    type: "outcomeDeployerLimits",
    ...params,
  });
  return config.transport.request("info", request, signal);
}
