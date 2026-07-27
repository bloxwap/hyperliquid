/**
 * Mock transport for offline Subscription API tests.
 *
 * Records every `subscribe(...)` call — channel, validated payload, wrapped listener and
 * options — and resolves with a stub {@linkcode ISubscription}, so tests can assert exactly
 * what the API layer sent and replay synthetic events through the captured listener.
 *
 * @module
 */

import type { ISubscription, ISubscriptionTransport, TransportError } from "@bloxwap/hyperliquid";

/** Subscription options as seen by the transport. */
export interface MockSubscribeOptions {
  signal?: AbortSignal;
  onError?: (error: TransportError) => void;
}

/** One recorded subscription, after request-schema validation (so `type` is always set). */
export interface MockSubscribeCall {
  channel: string;
  payload: unknown;
  listener: (data: CustomEvent<unknown>) => void;
  options?: MockSubscribeOptions;
}

/** An {@linkcode ISubscriptionTransport} that records subscriptions instead of opening a socket. */
export class MockSubscriptionTransport implements ISubscriptionTransport {
  readonly calls: MockSubscribeCall[] = [];

  subscribe<T>(
    channel: string,
    payload: unknown,
    listener: (data: CustomEvent<T>) => void,
    options?: MockSubscribeOptions,
  ): Promise<ISubscription> {
    this.calls.push({ channel, payload, listener: listener as (data: CustomEvent<unknown>) => void, options });
    return Promise.resolve({ unsubscribe: () => Promise.resolve() });
  }

  /** Replays a server event to the listener captured by the `index`-th subscribe call (default: last). */
  emit(detail: unknown, index: number = this.calls.length - 1): void {
    this.calls[index].listener({ detail } as CustomEvent<unknown>);
  }
}
