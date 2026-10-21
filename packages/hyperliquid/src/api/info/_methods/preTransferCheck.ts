import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address } from "../../_schemas.ts";

/**
 * Request user existence check before transfer.
 */
export const PreTransferCheckRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("preTransferCheck"),
    /** User address. */
    user: Address,
    /** Source address. */
    source: Address,
  });
})();
export type PreTransferCheckRequest = v.InferOutput<typeof PreTransferCheckRequest>;

/**
 * Pre-transfer user existence check result.
 */
export type PreTransferCheckResponse = {
  /**
   * Activation fee.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  fee: string;
  /** Whether the user is sanctioned. */
  isSanctioned: boolean;
  /** Whether the user exists. */
  userExists: boolean;
  /** Whether the user has sent a transaction. */
  userHasSentTx: boolean;
};

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode preTransferCheck} function. */
export type PreTransferCheckParameters = Omit<v.InferInput<typeof PreTransferCheckRequest>, "type">;

/**
 * Request user existence check before transfer.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Pre-transfer user existence check result.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { preTransferCheck } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await preTransferCheck({ transport }, {
 *   user: "0x...",
 *   source: "0x...",
 * });
 * ```
 */
export function preTransferCheck(
  config: InfoConfig,
  params: PreTransferCheckParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PreTransferCheckResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    PreTransferCheckRequest,
    {
      type: "preTransferCheck",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
