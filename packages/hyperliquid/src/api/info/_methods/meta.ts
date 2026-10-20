import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import type { MarginTableResponse } from "./marginTable.ts";

/**
 * Request trading metadata.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perpetuals-metadata-universe-and-margin-tables
 */
export const MetaRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("meta"),
    /** DEX name (empty string for main dex). */
    dex: v.optional(v.string()),
  });
})();
export type MetaRequest = v.InferOutput<typeof MetaRequest>;

/**
 * Metadata for perpetual assets.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perpetuals-metadata-universe-and-margin-tables
 */
export type MetaResponse = {
  /** Trading universes available for perpetual trading. */
  universe: {
    /** Minimum decimal places for order sizes. */
    szDecimals: number;
    /** Name of the universe. */
    name: string;
    /** Maximum allowed leverage. */
    maxLeverage: number;
    /** Unique identifier for the margin requirements table. */
    marginTableId: number;
    /**
     * Indicates if only isolated margin trading is allowed.
     *
     * @deprecated use `marginMode` instead.
     */
    onlyIsolated?: true;
    /** Indicates if the universe is delisted. */
    isDelisted?: true;
    /** Trading margin mode constraint. */
    marginMode?: "strictIsolated" | "noCross" | "normal";
    /** Indicates if growth mode is enabled. */
    growthMode?: "enabled";
    /** Per-asset deployer fee scale. */
    deployerFeeScale?: string;
    /** Timestamp of the last per-asset fee scale change. */
    lastFeeScaleChangeTime?: string;
    /** Timestamp of the last growth mode change. */
    lastGrowthModeChangeTime?: string;
  }[];
  /** Margin requirement tables for different leverage tiers. */
  marginTables: [
    /** Margin requirements table ID. */
    id: number,
    /** Margin requirements table. */
    table: MarginTableResponse,
  ][];
  /** Collateral token index. */
  collateralToken: number;
};

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, isAbortSignal, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode meta} function. */
export type MetaParameters = Omit<v.InferInput<typeof MetaRequest>, "type">;

/**
 * Request trading metadata.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Metadata for perpetual assets.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { meta } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await meta({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perpetuals-metadata-universe-and-margin-tables
 */
export function meta(
  config: InfoConfig,
  params?: MetaParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<MetaResponse>;
export function meta(config: InfoConfig, signal?: AbortSignal): Promise<MetaResponse>;
export function meta(
  config: InfoConfig,
  paramsOrSignal?: MetaParameters | AbortSignal,
  maybeSignalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<MetaResponse> {
  const params = isAbortSignal(paramsOrSignal) ? {} : paramsOrSignal;
  const { signal, skipValidation } = infoOptions(isAbortSignal(paramsOrSignal) ? paramsOrSignal : maybeSignalOrOptions);

  const request = parseInfo(
    MetaRequest,
    {
      type: "meta",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
