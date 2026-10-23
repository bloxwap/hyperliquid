/** Shared identity and lifecycle hooks for SDK-owned subscription transport wrappers. */
import type { ISubscriptionTransport } from "../../../../transport/mod.ts";

/** Underlying transport identities, weakly owned by their SDK wrapper. */
const identities = new WeakMap<ISubscriptionTransport, ISubscriptionTransport>();

/** Records the ultimate transport for an SDK-owned wrapper without changing third-party transports. */
export function registerSubscriptionTransport(wrapper: ISubscriptionTransport, inner: ISubscriptionTransport): void {
  identities.set(wrapper, subscriptionTransportIdentity(inner));
}

/** Returns the underlying identity used for per-transport subscription work. */
export function subscriptionTransportIdentity(transport: ISubscriptionTransport): ISubscriptionTransport {
  return identities.get(transport) ?? transport;
}

/** Internal notification when tracking retires a subscription outside its method's returned handle. */
export const ON_TRACKED_UNSUBSCRIBE = Symbol("onTrackedUnsubscribe");
