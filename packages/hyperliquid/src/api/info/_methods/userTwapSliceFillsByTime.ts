import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address, UnsignedInteger } from "../../_schemas.ts";
import type { UserTwapSliceFillsResponse } from "./userTwapSliceFills.ts";

/**
 * Request user TWAP slice fills by time.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
 */
export const UserTwapSliceFillsByTimeRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("userTwapSliceFillsByTime"),
    /** User address. */
    user: Address,
    /** Start time (in ms since epoch). */
    startTime: UnsignedInteger,
    /** End time (in ms since epoch). */
    endTime: v.nullish(UnsignedInteger),
  });
})();
export type UserTwapSliceFillsByTimeRequest = v.InferOutput<typeof UserTwapSliceFillsByTimeRequest>;

/**
 * Array of user's TWAP slice fill by time.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
 */
export type UserTwapSliceFillsByTimeResponse = UserTwapSliceFillsResponse;

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode userTwapSliceFillsByTime} function. */
export type UserTwapSliceFillsByTimeParameters = Omit<v.InferInput<typeof UserTwapSliceFillsByTimeRequest>, "type">;

/**
 * Request user TWAP slice fills by time.
 *
 * The response is capped per request for a given time range.
 * To fetch a larger range, use {@linkcode userTwapSliceFillsByTimeAll}, which paginates automatically.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of user's TWAP slice fill by time.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { userTwapSliceFillsByTime } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await userTwapSliceFillsByTime({ transport }, {
 *   user: "0x...",
 *   startTime: Date.now() - 1000 * 60 * 60 * 24,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
 */
export function userTwapSliceFillsByTime(
  config: InfoConfig,
  params: UserTwapSliceFillsByTimeParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<UserTwapSliceFillsByTimeResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    UserTwapSliceFillsByTimeRequest,
    {
      type: "userTwapSliceFillsByTime",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
