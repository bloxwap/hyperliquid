/**
 * Mock transports for offline Explorer API tests.
 *
 * `MockExplorerTransport` answers `explorer` requests from a scripted handler instead of the
 * network and records every call (endpoint, payload, signal), so tests can assert the exact
 * request a method built. `MockExplorerSubscriptionTransport` records subscriptions the same
 * way and lets a test dispatch events into the recorded listener. Both support error injection.
 *
 * @module
 */

import type { IRequestTransport, ISubscription, ISubscriptionTransport, TransportError } from "@bloxwap/hyperliquid";

/** One recorded request, after request-schema validation (so `type` is always set). */
export interface MockExplorerCall {
  endpoint: "explorer";
  payload: unknown;
  signal?: AbortSignal;
}

/** An {@linkcode IRequestTransport} over the `explorer` endpoint that serves canned responses for offline tests. */
export class MockExplorerTransport implements IRequestTransport<"explorer"> {
  readonly isTestnet = true;
  readonly calls: MockExplorerCall[] = [];

  /** When set, requests reject with this error instead of resolving. */
  error: unknown;

  constructor(readonly handler: (payload: Record<string, unknown>) => unknown = () => ({})) {}

  request<T>(endpoint: "explorer", payload: unknown, signal?: AbortSignal): Promise<T> {
    this.calls.push({ endpoint, payload, signal });
    if (this.error !== undefined) return Promise.reject(this.error);
    return Promise.resolve(this.handler(payload as Record<string, unknown>) as T);
  }
}

/** One recorded subscription. */
export interface MockSubscribeCall {
  channel: string;
  payload: unknown;
  listener: (data: CustomEvent<unknown>) => void;
  options?: {
    signal?: AbortSignal;
    onError?: (error: TransportError) => void;
  };
}

/** An {@linkcode ISubscriptionTransport} that records subscriptions for offline tests. */
export class MockExplorerSubscriptionTransport implements ISubscriptionTransport {
  readonly calls: MockSubscribeCall[] = [];

  /** When set, `subscribe` rejects with this error instead of resolving. */
  error: unknown;

  /** Number of times the returned subscription handles were unsubscribed. */
  unsubscribeCount = 0;

  subscribe<T>(
    channel: string,
    payload: unknown,
    listener: (data: CustomEvent<T>) => void,
    options?: MockSubscribeCall["options"],
  ): Promise<ISubscription> {
    this.calls.push({ channel, payload, listener: listener as (data: CustomEvent<unknown>) => void, options });
    if (this.error !== undefined) return Promise.reject(this.error);
    return Promise.resolve({
      unsubscribe: () => {
        this.unsubscribeCount++;
        return Promise.resolve();
      },
    });
  }

  /** Feeds `detail` to the listener recorded for `channel`, wrapped in a `CustomEvent`. */
  dispatch(channel: string, detail: unknown): void {
    const call = this.calls.find((c) => c.channel === channel);
    call?.listener(new CustomEvent(channel, { detail }));
  }
}
