import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request user portfolio.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-portfolio
 */
export const PortfolioRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("portfolio"),
    /** User address. */
    user: Address,
  });
})();
export type PortfolioRequest = v.InferOutput<typeof PortfolioRequest>;

/** Portfolio metrics snapshot. */
type Portfolio = {
  /** History entries for account value as [timestamp, value]. */
  accountValueHistory: [
    /** Timestamp (in ms since epoch). */
    timestamp: number,
    /**
     * Account value.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    value: string,
  ][];
  /** History entries for profit and loss as [timestamp, value]. */
  pnlHistory: [
    /** Timestamp (in ms since epoch). */
    timestamp: number,
    /**
     * Profit and loss.
     * @pattern ^-?[0-9]+(\.[0-9]+)?$
     */
    value: string,
  ][];
  /**
   * Volume metric for the portfolio.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  vlm: string;
};

/**
 * Portfolio metrics grouped by time periods.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-portfolio
 */
export type PortfolioResponse = [
  [period: "day", data: Portfolio],
  [period: "week", data: Portfolio],
  [period: "month", data: Portfolio],
  [period: "allTime", data: Portfolio],
  [period: "perpDay", data: Portfolio],
  [period: "perpWeek", data: Portfolio],
  [period: "perpMonth", data: Portfolio],
  [period: "perpAllTime", data: Portfolio],
];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode portfolio} function. */
export type PortfolioParameters = Omit<v.InferInput<typeof PortfolioRequest>, "type">;

/**
 * Request user portfolio.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Portfolio metrics grouped by time periods.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { portfolio } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await portfolio({ transport }, {
 *   user: "0x...",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-portfolio
 */
export function portfolio(
  config: InfoConfig,
  params: PortfolioParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PortfolioResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    PortfolioRequest,
    {
      type: "portfolio",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
