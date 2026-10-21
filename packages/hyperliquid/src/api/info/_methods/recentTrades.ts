import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request recent trades.
 */
export const RecentTradesRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("recentTrades"),
    /** Asset symbol (e.g., BTC). */
    coin: v.string(),
  });
})();
export type RecentTradesRequest = v.InferOutput<typeof RecentTradesRequest>;

/**
 * Array of recent trades.
 */
export type RecentTradesResponse = {
  /** Asset symbol (e.g., BTC). */
  coin: string;
  /** Trade side ("B" = Bid/Buy, "A" = Ask/Sell). */
  side: "B" | "A";
  /**
   * Trade price.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  px: string;
  /**
   * Trade size.
   * @pattern ^[0-9]+(\.[0-9]+)?$
   */
  sz: string;
  /** Trade timestamp (in ms since epoch). */
  time: number;
  /**
   * Transaction hash.
   * @pattern ^0x[a-fA-F0-9]{64}$
   */
  hash: `0x${string}`;
  /** Trade ID. */
  tid: number;
  /** Addresses of the two users involved in the trade `[buyer, seller]`. */
  users: [
    /** @pattern ^0x[a-fA-F0-9]{40}$ */
    buyer: `0x${string}`,
    /** @pattern ^0x[a-fA-F0-9]{40}$ */
    seller: `0x${string}`,
  ];
}[];

// ============================================================
// Execution Logic
// ============================================================

import { type InfoConfig, type InfoRequestOptions, infoOptions, parseInfo } from "./_base/mod.ts";

/** Request parameters for the {@linkcode recentTrades} function. */
export type RecentTradesParameters = Omit<v.InferInput<typeof RecentTradesRequest>, "type">;

/**
 * Request recent trades.
 *
 * @param config General configuration for Info API requests.
 * @param params Parameters specific to the API request.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of recent trades.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { recentTrades } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await recentTrades({ transport }, {
 *   coin: "ETH",
 * });
 * ```
 */
export function recentTrades(
  config: InfoConfig,
  params: RecentTradesParameters,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<RecentTradesResponse> {
  const { signal, skipValidation } = infoOptions(signalOrOptions);
  const request = parseInfo(
    RecentTradesRequest,
    {
      type: "recentTrades",
      ...params,
    },
    skipValidation,
  );
  return config.transport.request("info", request, signal);
}
