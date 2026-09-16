/**
 * Configuration types for Explorer API requests.
 * @module
 */

import type { IRequestTransport, ISubscriptionTransport } from "../../../../transport/mod.ts";

/** Configuration for Explorer API requests. */
export interface ExplorerConfig<
  T extends IRequestTransport<"explorer"> | ISubscriptionTransport = IRequestTransport<"explorer"> &
    ISubscriptionTransport,
> {
  /** The transport used to connect to the Hyperliquid API. */
  transport: T;
}

/**
 * Configuration for the Explorer API with separate transports for requests and subscriptions.
 *
 * Requests (e.g. `blockDetails`) go through `requestTransport` and subscriptions
 * (e.g. `explorerBlock`) through `subscriptionTransport`, so one client can use an
 * `HttpTransport` and a `WebSocketTransport` at the same time.
 */
export interface ExplorerDualConfig {
  /** The transport used for Explorer API requests (e.g. `HttpTransport` on the RPC endpoint). */
  requestTransport: IRequestTransport<"explorer">;
  /** The transport used for Explorer API subscriptions (e.g. `WebSocketTransport` on the RPC WebSocket URL). */
  subscriptionTransport: ISubscriptionTransport;
}
