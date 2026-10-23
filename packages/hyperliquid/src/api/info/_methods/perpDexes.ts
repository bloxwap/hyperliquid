// ============================================================
// Execution Logic
// ============================================================

import type { InfoConfig, InfoRequestOptions } from "./_base/mod.ts";
import { perpDexs, type PerpDexsResponse } from "./perpDexs.ts";

/** Response of the {@linkcode perpDexes} function. */
export type PerpDexesResponse = PerpDexsResponse;

/**
 * Request all perpetual dexes.
 *
 * Friendly alias of {@linkcode perpDexs} (the wire name): sends the same `perpDexs` request and
 * returns its response unchanged.
 *
 * @param config General configuration for Info API requests.
 * @param signalOrOptions {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel
 * the request, or an {@linkcode InfoRequestOptions} object.
 * @return Array of perpetual dexes (null is main dex).
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { perpDexes } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await perpDexes({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-all-perpetual-dexs
 */
export function perpDexes(
  config: InfoConfig,
  signalOrOptions?: AbortSignal | InfoRequestOptions,
): Promise<PerpDexesResponse> {
  return perpDexs(config, signalOrOptions);
}
