import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request leading vaults for a user.
 */
export const LeadingVaultsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("leadingVaults"),
    /** User address. */
    user: Address,
  });
})();
export type LeadingVaultsRequest = v.InferOutput<typeof LeadingVaultsRequest>;

/**
 * Array of leading vaults for a user.
 */
export type LeadingVaultsResponse = {
  /**
   * Vault address.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  address: `0x${string}`;
  /** Vault name. */
  name: string;
}[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode leadingVaults} function. */
export type LeadingVaultsParameters = Omit<v.InferInput<typeof LeadingVaultsRequest>, "type">;

/**
 * Request leading vaults for a user.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of leading vaults for a user.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { leadingVaults } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await leadingVaults({ transport }, {
 *   user: "0x...",
 * });
 * ```
 */
export function leadingVaults(
  config: InfoConfig,
  params: LeadingVaultsParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<LeadingVaultsResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    LeadingVaultsRequest,
    {
      type: "leadingVaults",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
