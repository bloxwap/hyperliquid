import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import type { BorrowLendReserveStateResponse } from "./borrowLendReserveState.ts";

/**
 * Request all borrow/lend reserve states.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-all-borrow-lend-reserve-states
 */
export const AllBorrowLendReserveStatesRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("allBorrowLendReserveStates"),
  });
})();
export type AllBorrowLendReserveStatesRequest = v.InferOutput<typeof AllBorrowLendReserveStatesRequest>;

/**
 * Array of tuples of reserve IDs and their borrow/lend reserve state.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-all-borrow-lend-reserve-states
 */
export type AllBorrowLendReserveStatesResponse = [
  /** Reserve ID. */
  reserveId: number,
  /** Borrow/lend reserve state. */
  state: BorrowLendReserveStateResponse,
][];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/**
 * Request all borrow/lend reserve states.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of tuples of reserve IDs and their borrow/lend reserve state.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { allBorrowLendReserveStates } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await allBorrowLendReserveStates({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-all-borrow-lend-reserve-states
 */
export function allBorrowLendReserveStates(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<AllBorrowLendReserveStatesResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    AllBorrowLendReserveStatesRequest,
    {
      type: "allBorrowLendReserveStates",
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
