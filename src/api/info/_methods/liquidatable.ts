import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request liquidatable.
 */
export const LiquidatableRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("liquidatable"),
  });
})();
export type LiquidatableRequest = v.InferOutput<typeof LiquidatableRequest>;

/**
 * Array of liquidatable positions.
 */
export type LiquidatableResponse = {
  /**
   * User address.
   * @pattern ^0x[a-fA-F0-9]{40}$
   */
  user: `0x${string}`;
  /**
   * Position index.
   *
   * @unconfirmed Only the `isolated` variant has been observed; a `cross` variant may also exist.
   */
  positionIndex: {
    /** Isolated position details. */
    isolated: {
      /** Asset index. */
      asset: number;
    };
  };
  /**
   * Available margin.
   *
   * @unconfirmed The meaning of the two tuple values has not been verified against the docs.
   */
  marginAvailable: [number, number];
}[];

// ============================================================
// Execution Logic
// ============================================================

import { parse } from "../../../_base.ts";
import type { InfoConfig } from "./_base/mod.ts";

/**
 * Request liquidatable.
 *
 * @param config General configuration for Info API requests.
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Array of liquidatable positions.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { liquidatable } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await liquidatable({ transport });
 * ```
 */
export function liquidatable(config: InfoConfig, signal?: AbortSignal): Promise<LiquidatableResponse> {
  const request = parse(LiquidatableRequest, {
    type: "liquidatable",
  });
  return config.transport.request("info", request, signal);
}
