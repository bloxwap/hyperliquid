/**
 * Hyperliquid API TypeScript SDK.
 *
 * The main entrypoint exports:
 * - Transports: {@link HttpTransport}, {@link WebSocketTransport}
 * - Clients: {@link InfoClient}, {@link ExchangeClient}, {@link SubscriptionClient}, {@link ExplorerClient}
 *
 * For tree-shakeable, low-level access you can import request methods directly from:
 * - `@bloxwap/hyperliquid/api/info`
 * - `@bloxwap/hyperliquid/api/exchange`
 * - `@bloxwap/hyperliquid/api/subscription`
 * - `@bloxwap/hyperliquid/api/explorer`
 *
 * Extra utilities are available in:
 * - `@bloxwap/hyperliquid/utils` (formatting, symbol conversion)
 * - `@bloxwap/hyperliquid/signing` (low-level signing helpers)
 *
 * @example Quick start
 * ```ts
 * import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";
 *
 * const transport = new HttpTransport();
 * const info = new InfoClient({ transport });
 *
 * const mids = await info.allMids();
 * console.log(mids);
 * ```
 *
 * @module
 */

export { HyperliquidError, ValidationError } from "./_base.ts";
export { AbstractWalletError } from "./signing/mod.ts";
export * from "./transport/mod.ts";
export * from "./api/exchange/client.ts";
export * from "./api/explorer/client.ts";
export * from "./api/info/client.ts";
export * from "./api/subscription/client.ts";
