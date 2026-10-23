import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request validator summaries.
 */
export const ValidatorSummariesRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("validatorSummaries"),
  });
})();
export type ValidatorSummariesRequest = v.InferOutput<typeof ValidatorSummariesRequest>;

/** Statistics for validator performance over a time period. */
type ValidatorStats = {
  /**
   * Fraction of time the validator was online.
   * @pattern ^0(\.\d+)?|1(\.0+)?$
   */
  uptimeFraction: string;
  /**
   * Predicted annual percentage rate of returns.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  predictedApr: string;
  /** Number of samples used for statistics calculation. */
  nSamples: number;
};

/**
 * Array of validator performance statistics.
 */
export type ValidatorSummariesResponse = {
  /**
   * Address of the validator.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  validator: `0x${string}`;
  /**
   * Address of the validator signer.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  signer: `0x${string}`;
  /** Name of the validator. */
  name: string;
  /** Description of the validator. */
  description: string;
  /** Number of blocks produced recently. */
  nRecentBlocks: number;
  /** Total amount of tokens staked **(unsafe integer)**. */
  stake: number;
  /** Whether the validator is currently jailed. */
  isJailed: boolean;
  /** Timestamp when the validator can be unjailed (in ms since epoch). */
  unjailableAfter: number | null;
  /** Whether the validator is currently active. */
  isActive: boolean;
  /**
   * Commission rate charged by the validator.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  commission: string;
  /** Performance statistics over different time periods. */
  stats: [
    [period: "day", stats: ValidatorStats],
    [period: "week", stats: ValidatorStats],
    [period: "month", stats: ValidatorStats],
  ];
}[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request validator summaries.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of validator performance statistics.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { validatorSummaries } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await validatorSummaries({ transport });
 * ```
 */
export function validatorSummaries(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<ValidatorSummariesResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    ValidatorSummariesRequest,
    {
      type: "validatorSummaries",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
