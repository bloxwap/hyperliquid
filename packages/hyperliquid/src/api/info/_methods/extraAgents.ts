import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request user extra agents.
 */
export const ExtraAgentsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("extraAgents"),
    /** User address. */
    user: Address,
  });
})();
export type ExtraAgentsRequest = v.InferOutput<typeof ExtraAgentsRequest>;

/**
 * Array of extra agent details for a user.
 */
export type ExtraAgentsResponse = {
  /**
   * Extra agent address.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  address: `0x${string}`;
  /** Extra agent name. */
  name: string;
  /** Validity period as a timestamp (in ms since epoch); `null` when the agent has no expiry. */
  validUntil: number | null;
}[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode extraAgents} function. */
export type ExtraAgentsParameters = Omit<v.InferInput<typeof ExtraAgentsRequest>, "type">;

/**
 * Request user extra agents.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of extra agent details for a user.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { extraAgents } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await extraAgents({ transport }, {
 *   user: "0x...",
 * });
 * ```
 */
export function extraAgents(
  config: InfoConfig,
  params: ExtraAgentsParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<ExtraAgentsResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    ExtraAgentsRequest,
    {
      type: "extraAgents",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
