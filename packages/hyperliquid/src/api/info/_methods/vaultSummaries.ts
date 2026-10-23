import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import type { VaultRelationship } from "./_base/mod.ts";

/**
 * Request a list of vaults less than 2 hours old.
 */
export const VaultSummariesRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("vaultSummaries"),
  });
})();
export type VaultSummariesRequest = v.InferOutput<typeof VaultSummariesRequest>;

/**
 * Array of vaults less than 2 hours old.
 */
export type VaultSummariesResponse = {
  /** Vault name. */
  name: string;
  /**
   * Vault address.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  vaultAddress: `0x${string}`;
  /**
   * Leader address.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  leader: `0x${string}`;
  /**
   * Total value locked.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  tvl: string;
  /** Vault closure status. */
  isClosed: boolean;
  /** Vault relationship type. */
  relationship: VaultRelationship;
  /** Creation timestamp (in ms since epoch). */
  createTimeMillis: number;
}[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request a list of vaults less than 2 hours old.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of vaults less than 2 hours old.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { vaultSummaries } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await vaultSummaries({ transport });
 * ```
 */
export function vaultSummaries(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<VaultSummariesResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    VaultSummariesRequest,
    {
      type: "vaultSummaries",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
