/**
 * Client for the Hyperliquid Explorer API endpoint.
 * @module
 */

import type { IRequestTransport, ISubscription, ISubscriptionTransport, TransportError } from "../../transport/mod.ts";
import type { ExplorerConfig, ExplorerDualConfig } from "./_methods/_base/mod.ts";

// ============================================================
// Methods Imports
// ============================================================

import { blockDetails, type BlockDetailsParameters, type BlockDetailsResponse } from "./_methods/blockDetails.ts";
import { explorerBlock, type ExplorerBlockEvent } from "./_methods/explorerBlock.ts";
import { explorerTxs, type ExplorerTxsEvent } from "./_methods/explorerTxs.ts";
import { txDetails, type TxDetailsParameters, type TxDetailsResponse } from "./_methods/txDetails.ts";
import { userDetails, type UserDetailsParameters, type UserDetailsResponse } from "./_methods/userDetails.ts";

// ============================================================
// Client
// ============================================================

/**
 * An {@linkcode ExplorerClient} that can execute requests.
 *
 * Named so that calling a request method without a request-capable transport reports
 * "not assignable to method's 'this' of type 'RequestCapableExplorerClient'".
 */
type RequestCapableExplorerClient = ExplorerClient<IRequestTransport<"explorer">>;

/**
 * An {@linkcode ExplorerClient} that can subscribe to events.
 *
 * Named so that calling a subscription method without a subscription-capable transport reports
 * "not assignable to method's 'this' of type 'SubscriptionCapableExplorerClient'".
 */
type SubscriptionCapableExplorerClient = ExplorerClient<ISubscriptionTransport>;

/**
 * Access to the Hyperliquid blockchain explorer.
 *
 * Requests use an `HttpTransport` and subscriptions use a `WebSocketTransport`, both on the RPC endpoint.
 *
 * Pass a single transport via `{ transport }`, or separate transports via
 * `{ requestTransport, subscriptionTransport }` (see {@link ExplorerDualConfig}) to query and
 * subscribe from one client.
 */
export class ExplorerClient<
  T extends IRequestTransport<"explorer"> | ISubscriptionTransport = IRequestTransport<"explorer"> &
    ISubscriptionTransport,
> {
  readonly config: ExplorerConfig<T> | ExplorerDualConfig;

  /**
   * Creates an instance of the ExplorerClient.
   *
   * @param config Configuration for Explorer API requests. See {@link ExplorerConfig} or {@link ExplorerDualConfig}.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * // `HttpTransport` on the RPC URL for requests, or `WebSocketTransport` on the RPC WebSocket URL for subscriptions
   * const transport = new hl.HttpTransport();
   *
   * const explorerClient = new hl.ExplorerClient({ transport });
   * ```
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * // Separate transports, so one client can both query and subscribe
   * const explorerClient = new hl.ExplorerClient({
   *   requestTransport: new hl.HttpTransport(),
   *   subscriptionTransport: new hl.WebSocketTransport({ url: "wss://rpc.hyperliquid.xyz/ws" }),
   * });
   * ```
   */
  constructor(config: ExplorerConfig<T>);
  constructor(config: ExplorerDualConfig);
  constructor(config: ExplorerConfig<T> | ExplorerDualConfig) {
    this.config = config;
  }

  /**
   * Request block details by block height.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Response containing block information.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   * @throws {ApiRequestError} When the API returns an unsuccessful response.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // only `HttpTransport` supports this API
   * const client = new hl.ExplorerClient({ transport });
   *
   * const data = await client.blockDetails({ height: 123 });
   * ```
   */
  blockDetails(
    this: RequestCapableExplorerClient,
    params: BlockDetailsParameters,
    signal?: AbortSignal,
  ): Promise<BlockDetailsResponse> {
    const config = this.config;
    const transport = "transport" in config ? config.transport : config.requestTransport;
    return blockDetails({ transport }, params, signal);
  }

  /**
   * Subscribe to explorer block updates.
   *
   * @param listener A callback function to be called when the event is received.
   * @param onError An optional callback function to be called when the subscription fails.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport({ url: "wss://rpc.hyperliquid.xyz/ws" }); // only `WebSocketTransport` supports this API
   * const client = new hl.ExplorerClient({ transport });
   *
   * const sub = await client.explorerBlock((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  explorerBlock(
    this: SubscriptionCapableExplorerClient,
    listener: (data: ExplorerBlockEvent) => void,
    onError?: (error: TransportError) => void,
  ): Promise<ISubscription> {
    const config = this.config;
    const transport = "transport" in config ? config.transport : config.subscriptionTransport;
    return explorerBlock({ transport }, listener, onError);
  }

  /**
   * Subscribe to explorer transaction updates.
   *
   * @param listener A callback function to be called when the event is received.
   * @param onError An optional callback function to be called when the subscription fails.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport({ url: "wss://rpc.hyperliquid.xyz/ws" }); // only `WebSocketTransport` supports this API
   * const client = new hl.ExplorerClient({ transport });
   *
   * const sub = await client.explorerTxs((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  explorerTxs(
    this: SubscriptionCapableExplorerClient,
    listener: (data: ExplorerTxsEvent) => void,
    onError?: (error: TransportError) => void,
  ): Promise<ISubscription> {
    const config = this.config;
    const transport = "transport" in config ? config.transport : config.subscriptionTransport;
    return explorerTxs({ transport }, listener, onError);
  }

  /**
   * Request transaction details by transaction hash.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Transaction details.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   * @throws {ApiRequestError} When the API returns an unsuccessful response.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // only `HttpTransport` supports this API
   * const client = new hl.ExplorerClient({ transport });
   *
   * const data = await client.txDetails({ hash: "0x..." });
   * ```
   */
  txDetails(
    this: RequestCapableExplorerClient,
    params: TxDetailsParameters,
    signal?: AbortSignal,
  ): Promise<TxDetailsResponse> {
    const config = this.config;
    const transport = "transport" in config ? config.transport : config.requestTransport;
    return txDetails({ transport }, params, signal);
  }

  /**
   * Request array of user transaction details.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user transaction details.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   * @throws {ApiRequestError} When the API returns an unsuccessful response.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // only `HttpTransport` supports this API
   * const client = new hl.ExplorerClient({ transport });
   *
   * const data = await client.userDetails({ user: "0x..." });
   * ```
   */
  userDetails(
    this: RequestCapableExplorerClient,
    params: UserDetailsParameters,
    signal?: AbortSignal,
  ): Promise<UserDetailsResponse> {
    const config = this.config;
    const transport = "transport" in config ? config.transport : config.requestTransport;
    return userDetails({ transport }, params, signal);
  }
}

// ============================================================
// Type Re-exports
// ============================================================

export type { ExplorerConfig, ExplorerDualConfig } from "./_methods/_base/mod.ts";

export type { BlockDetailsParameters, BlockDetailsResponse } from "./_methods/blockDetails.ts";
export type { ExplorerBlockEvent } from "./_methods/explorerBlock.ts";
export type { ExplorerTxsEvent } from "./_methods/explorerTxs.ts";
export type { TxDetailsParameters, TxDetailsResponse } from "./_methods/txDetails.ts";
export type { UserDetailsParameters, UserDetailsResponse } from "./_methods/userDetails.ts";
