/**
 * Configuration and option types for Subscription API methods.
 * @module
 */

import type { ISubscriptionTransport, TransportError } from "../../../../transport/mod.ts";

/** Configuration for subscription API requests. */
export interface SubscriptionConfig<T extends ISubscriptionTransport = ISubscriptionTransport> {
  /** The transport used to connect to the Hyperliquid API. */
  transport: T;
}

/** Options for Subscription API methods. */
export interface SubscriptionOptions {
  /** Stops waiting for the confirmation and detaches the listener. */
  signal?: AbortSignal;
  /**
   * Callback invoked at most once per subscribe call, when an already confirmed subscription fails:
   * - the server rejects a re-subscription after a reconnect;
   * - the connection is permanently terminated;
   * - the connection goes down while re-subscription is disabled.
   *
   * When several calls share one underlying subscription, every caller's callback fires.
   * Failures before the confirmation reject the subscribe promise instead.
   * After the callback fires, the subscription is removed and no further events or errors follow.
   * The same failure also aborts the resolved handle's `failureSignal`.
   */
  onError?: (error: TransportError) => void;
}
