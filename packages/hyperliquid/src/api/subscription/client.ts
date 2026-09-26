/**
 * Client for the Hyperliquid Subscription API endpoint.
 * @module
 */

import type { ClientSubscription, SubscriptionConfig, SubscriptionOptions } from "./_methods/_base/mod.ts";
import { trackerFor } from "./_methods/_base/_tracking.ts";

// ============================================================
// Methods Imports
// ============================================================

import { activeAssetCtx, type ActiveAssetCtxEvent, type ActiveAssetCtxParameters } from "./_methods/activeAssetCtx.ts";
import {
  activeAssetData,
  type ActiveAssetDataEvent,
  type ActiveAssetDataParameters,
} from "./_methods/activeAssetData.ts";
import {
  activeSpotAssetCtx,
  type ActiveSpotAssetCtxEvent,
  type ActiveSpotAssetCtxParameters,
} from "./_methods/activeSpotAssetCtx.ts";
import { allDexsAssetCtxs, type AllDexsAssetCtxsEvent } from "./_methods/allDexsAssetCtxs.ts";
import {
  allDexsClearinghouseState,
  type AllDexsClearinghouseStateEvent,
  type AllDexsClearinghouseStateParameters,
} from "./_methods/allDexsClearinghouseState.ts";
import { allMids, type AllMidsEvent, type AllMidsParameters } from "./_methods/allMids.ts";
import { assetCtxs, type AssetCtxsEvent, type AssetCtxsParameters } from "./_methods/assetCtxs.ts";
import { bbo, type BboEvent, type BboParameters } from "./_methods/bbo.ts";
import { candle, type CandleEvent, type CandleParameters } from "./_methods/candle.ts";
import {
  clearinghouseState,
  type ClearinghouseStateEvent,
  type ClearinghouseStateParameters,
} from "./_methods/clearinghouseState.ts";
import { fastAssetCtxs, type FastAssetCtxsEvent } from "./_methods/fastAssetCtxs.ts";
import { l2Book, type L2BookEvent, type L2BookParameters } from "./_methods/l2Book.ts";
import { notification, type NotificationEvent, type NotificationParameters } from "./_methods/notification.ts";
import { openOrders, type OpenOrdersEvent, type OpenOrdersParameters } from "./_methods/openOrders.ts";
import { orderUpdates, type OrderUpdatesEvent, type OrderUpdatesParameters } from "./_methods/orderUpdates.ts";
import { outcomeMetaUpdates, type OutcomeMetaUpdatesEvent } from "./_methods/outcomeMetaUpdates.ts";
import { spotAssetCtxs, type SpotAssetCtxsEvent } from "./_methods/spotAssetCtxs.ts";
import { spotState, type SpotStateEvent, type SpotStateParameters } from "./_methods/spotState.ts";
import { trades, type TradesEvent, type TradesParameters } from "./_methods/trades.ts";
import { twapStates, type TwapStatesEvent, type TwapStatesParameters } from "./_methods/twapStates.ts";
import { unsubscribeAll } from "./_methods/unsubscribeAll.ts";
import { userEvents, type UserEventsEvent, type UserEventsParameters } from "./_methods/userEvents.ts";
import { userFills, type UserFillsEvent, type UserFillsParameters } from "./_methods/userFills.ts";
import { userFundings, type UserFundingsEvent, type UserFundingsParameters } from "./_methods/userFundings.ts";
import {
  userHistoricalOrders,
  type UserHistoricalOrdersEvent,
  type UserHistoricalOrdersParameters,
} from "./_methods/userHistoricalOrders.ts";
import {
  userNonFundingLedgerUpdates,
  type UserNonFundingLedgerUpdatesEvent,
  type UserNonFundingLedgerUpdatesParameters,
} from "./_methods/userNonFundingLedgerUpdates.ts";
import {
  userTwapHistory,
  type UserTwapHistoryEvent,
  type UserTwapHistoryParameters,
} from "./_methods/userTwapHistory.ts";
import {
  userTwapSliceFills,
  type UserTwapSliceFillsEvent,
  type UserTwapSliceFillsParameters,
} from "./_methods/userTwapSliceFills.ts";
import { webData3, type WebData3Event, type WebData3Parameters } from "./_methods/webData3.ts";

// ============================================================
// Client
// ============================================================

/**
 * Real-time data via WebSocket subscriptions.
 *
 * Corresponds to {@link https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions | WebSocket subscriptions}.
 */
export class SubscriptionClient<C extends SubscriptionConfig = SubscriptionConfig> {
  readonly config: C;
  /**
   * `config` with the transport wrapped in its shared {@linkcode SubscriptionTracker}, so every
   * subscription opened through this client is registered for {@linkcode SubscriptionClient.unsubscribeAll}
   * and carries a guaranteed `failureSignal` (see {@linkcode ClientSubscription}).
   */
  private readonly _trackedConfig: SubscriptionConfig;

  /**
   * Creates an instance of the SubscriptionClient.
   *
   * @param config Configuration for Subscription API requests. See {@link SubscriptionConfig}.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   *
   * const subsClient = new hl.SubscriptionClient({ transport });
   * ```
   */
  constructor(config: C) {
    this.config = config;
    this._trackedConfig = { ...config, transport: trackerFor(config.transport) };
  }

  /**
   * Subscribe to context updates for a specific perpetual asset.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.activeAssetCtx({ coin: "ETH" }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  activeAssetCtx(
    params: ActiveAssetCtxParameters,
    listener: (data: ActiveAssetCtxEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return activeAssetCtx(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to trading data updates for a specific asset and user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.activeAssetData({ coin: "ETH", user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  activeAssetData(
    params: ActiveAssetDataParameters,
    listener: (data: ActiveAssetDataEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return activeAssetData(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to context updates for a specific spot asset.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.activeSpotAssetCtx({ coin: "@1" }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  activeSpotAssetCtx(
    params: ActiveSpotAssetCtxParameters,
    listener: (data: ActiveSpotAssetCtxEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return activeSpotAssetCtx(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to asset contexts for all DEXs.
   *
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.allDexsAssetCtxs((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  allDexsAssetCtxs(
    listener: (data: AllDexsAssetCtxsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return allDexsAssetCtxs(this._trackedConfig, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to clearinghouse states for all DEXs for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.allDexsClearinghouseState({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  allDexsClearinghouseState(
    params: AllDexsClearinghouseStateParameters,
    listener: (data: AllDexsClearinghouseStateEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return allDexsClearinghouseState(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to mid prices for all actively traded assets.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.allMids((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  allMids(listener: (data: AllMidsEvent) => void, options?: SubscriptionOptions): Promise<ClientSubscription>;
  allMids(
    params: AllMidsParameters,
    listener: (data: AllMidsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription>;
  allMids(
    paramsOrListener: AllMidsParameters | ((data: AllMidsEvent) => void),
    listenerOrOptions?: ((data: AllMidsEvent) => void) | SubscriptionOptions,
    maybeOptions?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    const isListenerFirst = typeof paramsOrListener === "function";
    const params = isListenerFirst ? {} : paramsOrListener;
    const listener = isListenerFirst ? paramsOrListener : (listenerOrOptions as (data: AllMidsEvent) => void);
    const options = isListenerFirst ? (listenerOrOptions as SubscriptionOptions | undefined) : maybeOptions;
    return allMids(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to asset contexts for all perpetual assets.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.assetCtxs((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  assetCtxs(listener: (data: AssetCtxsEvent) => void, options?: SubscriptionOptions): Promise<ClientSubscription>;
  assetCtxs(
    params: AssetCtxsParameters,
    listener: (data: AssetCtxsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription>;
  assetCtxs(
    paramsOrListener: AssetCtxsParameters | ((data: AssetCtxsEvent) => void),
    listenerOrOptions?: ((data: AssetCtxsEvent) => void) | SubscriptionOptions,
    maybeOptions?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    const isListenerFirst = typeof paramsOrListener === "function";
    const params = isListenerFirst ? {} : paramsOrListener;
    const listener = isListenerFirst ? paramsOrListener : (listenerOrOptions as (data: AssetCtxsEvent) => void);
    const options = isListenerFirst ? (listenerOrOptions as SubscriptionOptions | undefined) : maybeOptions;
    return assetCtxs(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to best bid and offer updates for a specific asset.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.bbo({ coin: "ETH" }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  bbo(
    params: BboParameters,
    listener: (data: BboEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return bbo(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to candlestick data updates for a specific asset.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.candle({ coin: "ETH", interval: "1h" }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  candle(
    params: CandleParameters,
    listener: (data: CandleEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return candle(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to clearinghouse state updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.clearinghouseState({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  clearinghouseState(
    params: ClearinghouseStateParameters,
    listener: (data: ClearinghouseStateEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return clearinghouseState(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to mark and mid prices for all assets.
   *
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.fastAssetCtxs((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  fastAssetCtxs(
    listener: (data: FastAssetCtxsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return fastAssetCtxs(this._trackedConfig, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to L2 order book updates for a specific asset.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.l2Book({ coin: "ETH" }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  l2Book(
    params: L2BookParameters,
    listener: (data: L2BookEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return l2Book(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to notification updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.notification({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  notification(
    params: NotificationParameters,
    listener: (data: NotificationEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return notification(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to open orders updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.openOrders({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  openOrders(
    params: OpenOrdersParameters,
    listener: (data: OpenOrdersEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return openOrders(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to order status updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.orderUpdates({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  orderUpdates(
    params: OrderUpdatesParameters,
    listener: (data: OrderUpdatesEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return orderUpdates(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to prediction market outcome/question metadata updates.
   *
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.outcomeMetaUpdates((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  outcomeMetaUpdates(
    listener: (data: OutcomeMetaUpdatesEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return outcomeMetaUpdates(this._trackedConfig, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to context updates for all spot assets.
   *
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.spotAssetCtxs((data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  spotAssetCtxs(
    listener: (data: SpotAssetCtxsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return spotAssetCtxs(this._trackedConfig, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to spot state updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.spotState({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  spotState(
    params: SpotStateParameters,
    listener: (data: SpotStateEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return spotState(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to real-time trade updates for a specific asset.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.trades({ coin: "ETH" }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  trades(
    params: TradesParameters,
    listener: (data: TradesEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return trades(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to TWAP states updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.twapStates({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  twapStates(
    params: TwapStatesParameters,
    listener: (data: TwapStatesEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return twapStates(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Unsubscribes every subscription opened through a `SubscriptionClient` on this transport.
   *
   * Subscriptions are unsubscribed concurrently; the promise resolves when every unsubscribe has
   * settled and rejects if any of them rejects. A subscribe call still waiting for its confirmation
   * resolves with an already-unsubscribed handle once the confirmation lands — it never joins the
   * registry, and this call does not wait for it. Subscriptions opened by calling the standalone
   * subscription functions or `ISubscriptionTransport.subscribe` directly are not tracked and are
   * unaffected. The teardown scope is the transport: subscriptions opened through any
   * `SubscriptionClient` sharing it are unsubscribed too.
   *
   * @return A promise that resolves when every tracked subscription has been unsubscribed.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * await client.unsubscribeAll();
   * ```
   */
  unsubscribeAll(): Promise<void> {
    return unsubscribeAll(this.config);
  }

  /**
   * Subscribe to non-order events for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.userEvents({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  userEvents(
    params: UserEventsParameters,
    listener: (data: UserEventsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return userEvents(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to trade fill updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.userFills({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  userFills(
    params: UserFillsParameters,
    listener: (data: UserFillsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return userFills(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to funding payment updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.userFundings({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  userFundings(
    params: UserFundingsParameters,
    listener: (data: UserFundingsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return userFundings(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to historical order updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.userHistoricalOrders({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  userHistoricalOrders(
    params: UserHistoricalOrdersParameters,
    listener: (data: UserHistoricalOrdersEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return userHistoricalOrders(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to non-funding ledger updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.userNonFundingLedgerUpdates({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  userNonFundingLedgerUpdates(
    params: UserNonFundingLedgerUpdatesParameters,
    listener: (data: UserNonFundingLedgerUpdatesEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return userNonFundingLedgerUpdates(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to TWAP order history updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.userTwapHistory({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  userTwapHistory(
    params: UserTwapHistoryParameters,
    listener: (data: UserTwapHistoryEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return userTwapHistory(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to TWAP execution updates for a specific user.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.userTwapSliceFills({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  userTwapSliceFills(
    params: UserTwapSliceFillsParameters,
    listener: (data: UserTwapSliceFillsEvent) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return userTwapSliceFills(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }

  /**
   * Subscribe to comprehensive user and market data updates.
   *
   * @param params Parameters specific to the API subscription.
   * @param listener A callback function to be called when the event is received.
   * @param options Options to control the subscription lifecycle.
   * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.WebSocketTransport();
   * const client = new hl.SubscriptionClient({ transport });
   *
   * const sub = await client.webData3({ user: "0x..." }, (data) => {
   *   console.log(data);
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
   */
  webData3(
    params: WebData3Parameters,
    listener: (data: WebData3Event) => void,
    options?: SubscriptionOptions,
  ): Promise<ClientSubscription> {
    return webData3(this._trackedConfig, params, listener, options) as Promise<ClientSubscription>;
  }
}

// ============================================================
// Type Re-exports
// ============================================================

export type { SubscriptionConfig, SubscriptionOptions } from "./_methods/_base/mod.ts";

export type {
  ActiveAssetCtxEvent as ActiveAssetCtxWsEvent,
  ActiveAssetCtxParameters as ActiveAssetCtxWsParameters,
} from "./_methods/activeAssetCtx.ts";
export type {
  ActiveAssetDataEvent as ActiveAssetDataWsEvent,
  ActiveAssetDataParameters as ActiveAssetDataWsParameters,
} from "./_methods/activeAssetData.ts";
export type {
  ActiveSpotAssetCtxEvent as ActiveSpotAssetCtxWsEvent,
  ActiveSpotAssetCtxParameters as ActiveSpotAssetCtxWsParameters,
} from "./_methods/activeSpotAssetCtx.ts";
export type { AllDexsAssetCtxsEvent as AllDexsAssetCtxsWsEvent } from "./_methods/allDexsAssetCtxs.ts";
export type {
  AllDexsClearinghouseStateEvent as AllDexsClearinghouseStateWsEvent,
  AllDexsClearinghouseStateParameters as AllDexsClearinghouseStateWsParameters,
} from "./_methods/allDexsClearinghouseState.ts";
export type { AllMidsEvent as AllMidsWsEvent, AllMidsParameters as AllMidsWsParameters } from "./_methods/allMids.ts";
export type {
  AssetCtxsEvent as AssetCtxsWsEvent,
  AssetCtxsParameters as AssetCtxsWsParameters,
} from "./_methods/assetCtxs.ts";
export type { BboEvent as BboWsEvent, BboParameters as BboWsParameters } from "./_methods/bbo.ts";
export type { CandleEvent as CandleWsEvent, CandleParameters as CandleWsParameters } from "./_methods/candle.ts";
export type {
  ClearinghouseStateEvent as ClearinghouseStateWsEvent,
  ClearinghouseStateParameters as ClearinghouseStateWsParameters,
} from "./_methods/clearinghouseState.ts";
export type { FastAssetCtxsEvent as FastAssetCtxsWsEvent } from "./_methods/fastAssetCtxs.ts";
export type { L2BookEvent as L2BookWsEvent, L2BookParameters as L2BookWsParameters } from "./_methods/l2Book.ts";
export type {
  NotificationEvent as NotificationWsEvent,
  NotificationParameters as NotificationWsParameters,
} from "./_methods/notification.ts";
export type {
  OpenOrdersEvent as OpenOrdersWsEvent,
  OpenOrdersParameters as OpenOrdersWsParameters,
} from "./_methods/openOrders.ts";
export type {
  OrderUpdatesEvent as OrderUpdatesWsEvent,
  OrderUpdatesParameters as OrderUpdatesWsParameters,
} from "./_methods/orderUpdates.ts";
export type { OutcomeMetaUpdatesEvent as OutcomeMetaUpdatesWsEvent } from "./_methods/outcomeMetaUpdates.ts";
export type { SpotAssetCtxsEvent as SpotAssetCtxsWsEvent } from "./_methods/spotAssetCtxs.ts";
export type {
  SpotStateEvent as SpotStateWsEvent,
  SpotStateParameters as SpotStateWsParameters,
} from "./_methods/spotState.ts";
export type { TradesEvent as TradesWsEvent, TradesParameters as TradesWsParameters } from "./_methods/trades.ts";
export type {
  TwapStatesEvent as TwapStatesWsEvent,
  TwapStatesParameters as TwapStatesWsParameters,
} from "./_methods/twapStates.ts";
export type { ClientSubscription } from "./_methods/unsubscribeAll.ts";
export type {
  UnknownUserEvent as UnknownUserWsEvent,
  UserEventsEvent as UserEventsWsEvent,
  UserEventsParameters as UserEventsWsParameters,
} from "./_methods/userEvents.ts";
export type {
  UserFillsEvent as UserFillsWsEvent,
  UserFillsParameters as UserFillsWsParameters,
} from "./_methods/userFills.ts";
export type {
  UserFundingsEvent as UserFundingsWsEvent,
  UserFundingsParameters as UserFundingsWsParameters,
} from "./_methods/userFundings.ts";
export type {
  UserHistoricalOrdersEvent as UserHistoricalOrdersWsEvent,
  UserHistoricalOrdersParameters as UserHistoricalOrdersWsParameters,
} from "./_methods/userHistoricalOrders.ts";
export type {
  UserNonFundingLedgerUpdatesEvent as UserNonFundingLedgerUpdatesWsEvent,
  UserNonFundingLedgerUpdatesParameters as UserNonFundingLedgerUpdatesWsParameters,
} from "./_methods/userNonFundingLedgerUpdates.ts";
export type {
  UserTwapHistoryEvent as UserTwapHistoryWsEvent,
  UserTwapHistoryParameters as UserTwapHistoryWsParameters,
} from "./_methods/userTwapHistory.ts";
export type {
  UserTwapSliceFillsEvent as UserTwapSliceFillsWsEvent,
  UserTwapSliceFillsParameters as UserTwapSliceFillsWsParameters,
} from "./_methods/userTwapSliceFills.ts";
export type {
  WebData3Event as WebData3WsEvent,
  WebData3Parameters as WebData3WsParameters,
} from "./_methods/webData3.ts";
