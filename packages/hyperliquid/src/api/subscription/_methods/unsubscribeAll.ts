import type { SubscriptionConfig } from "./_base/mod.ts";
import { trackerFor } from "./_base/_tracking.ts";

export type { ClientSubscription } from "./_base/_tracking.ts";

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
 * @param config General configuration for Subscription API subscriptions.
 * @return A promise that resolves when every tracked subscription has been unsubscribed.
 *
 * @example
 * ```ts
 * import { WebSocketTransport } from "@bloxwap/hyperliquid";
 * import { unsubscribeAll } from "@bloxwap/hyperliquid/api/subscription";
 *
 * const transport = new WebSocketTransport();
 *
 * await unsubscribeAll({ transport });
 * ```
 */
export function unsubscribeAll(config: SubscriptionConfig): Promise<void> {
  return trackerFor(config.transport).unsubscribeAll();
}
