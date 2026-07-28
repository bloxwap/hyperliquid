/**
 * Mock transport for offline Subscription API tests.
 *
 * Records every `subscribe(...)` call — channel, validated payload, wrapped listener and
 * options — and resolves with a stub {@linkcode ISubscription}, so tests can assert exactly
 * what the API layer sent and replay synthetic events through the captured listener.
 *
 * Event delivery mirrors the production WebSocket path: frames are filtered by the same
 * {@linkcode payloadEventType} / {@linkcode frameEventType} routing table, so a subscription
 * only sees frames that would reach it on a real socket. Residual method-level filters (interval,
 * dex, user when the route is coarser) still run inside the captured listener.
 *
 * @module
 */

import type { ISubscription, ISubscriptionTransport, TransportError } from "@bloxwap/hyperliquid";
import { frameEventType, payloadEventType } from "../../../src/transport/websocket/_routing.ts";

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
  /**
   * Event type the production transport would attach this listener to — the routed type when the
   * channel is keyable, the bare channel otherwise. Computed once at subscribe time.
   */
  eventType: string;
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
    this.calls.push({
      channel,
      payload,
      listener: listener as (data: CustomEvent<unknown>) => void,
      options,
      eventType: payloadEventType(channel, payload),
    });
    return Promise.resolve({ unsubscribe: () => Promise.resolve() });
  }

  /**
   * Replays a server event to the listener captured by the `index`-th subscribe call (default: last).
   *
   * When the subscription is on a routed type, a frame whose route key does not match is dropped —
   * the same filter {@linkcode HyperliquidEventTarget} applies on a live socket.
   */
  emit(detail: unknown, index: number = this.calls.length - 1): void {
    const call = this.calls[index];
    // Bare-channel subscriptions (unrouted channels, or payloads missing the key) receive every
    // frame on the channel. Routed subscriptions only receive frames that hash to the same type.
    if (call.eventType !== call.channel) {
      const frameType = frameEventType(call.channel, detail);
      if (frameType !== call.eventType) return;
    }
    call.listener({ detail } as CustomEvent<unknown>);
  }
}
