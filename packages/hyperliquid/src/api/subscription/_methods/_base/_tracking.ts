/**
 * Subscription tracking behind {@linkcode SubscriptionClient}: wraps the configured transport so
 * every confirmed subscription is registered for `unsubscribeAll()`, and every returned handle
 * carries a `failureSignal` — synthesized from the `onError` contract when the underlying
 * transport does not provide one.
 * @module
 */

import type { ISubscription, ISubscriptionTransport, TransportError } from "../../../../transport/mod.ts";

/**
 * Subscription handle returned by {@linkcode SubscriptionClient} methods.
 *
 * Like {@linkcode ISubscription}, but `failureSignal` is always present: the field is optional on
 * `ISubscription` only so third-party {@linkcode ISubscriptionTransport} implementations stay
 * valid — when the underlying handle carries none, the client synthesizes one from the `onError`
 * contract, so it aborts with the same failure `onError` would report, and never on a voluntary
 * {@linkcode ISubscription.unsubscribe | unsubscribe()}.
 */
export interface ClientSubscription extends ISubscription {
  /** Aborts — with the failure {@linkcode TransportError} as its reason — when this subscription fails. */
  readonly failureSignal: AbortSignal;
}

/**
 * The subscription registry behind one transport. Every {@linkcode SubscriptionClient} wraps its
 * transport in the shared tracker for that transport instance (see {@linkcode trackerFor}), so
 * `unsubscribeAll()` — the client method and the free function alike — tears down every
 * subscription opened through a client on that transport.
 */
export class SubscriptionTracker implements ISubscriptionTransport {
  /** Confirmed subscriptions not yet unsubscribed or failed. */
  private readonly _active = new Set<ClientSubscription>();
  /**
   * Bumped by {@linkcode SubscriptionTracker.unsubscribeAll}; a subscribe call whose confirmation
   * lands against a stale epoch is retired on arrival instead of joining the registry.
   */
  private _epoch = 0;

  /** Transport the tracker delegates to. */
  private readonly _inner: ISubscriptionTransport;

  constructor(inner: ISubscriptionTransport) {
    this._inner = inner;
  }

  /**
   * Delegates to the wrapped transport, chaining a private `onError` that records the failure for
   * the synthesized `failureSignal` and removes the failed handle from the registry.
   */
  subscribe<T>(
    channel: string,
    payload: unknown,
    listener: (data: CustomEvent<T>) => void,
    options?: {
      /** Stops waiting for the confirmation and detaches the listener. */
      signal?: AbortSignal;
      /** Forwarded to the wrapped transport after the tracker's own bookkeeping runs. */
      onError?: (error: TransportError) => void;
    },
  ): Promise<ClientSubscription> {
    const epoch = this._epoch;
    let failure: TransportError | undefined;
    let failureController: AbortController | undefined;
    let tracked: ClientSubscription | undefined;

    return this._inner
      .subscribe<T>(channel, payload, listener, {
        signal: options?.signal,
        onError: (error: TransportError) => {
          // A failed subscription is gone — it leaves the registry here, not on a later
          // unsubscribeAll(). The failure is recorded so a `failureSignal` first accessed
          // afterwards is still created already aborted with the same reason.
          failure = error;
          failureController?.abort(error);
          if (tracked !== undefined) this._active.delete(tracked);
          options?.onError?.(error);
        },
      })
      .then((subscription) => {
        // unsubscribeAll() ran while the confirmation was in flight: the teardown covers this
        // subscription too, so retire it on arrival and keep it out of the registry. Fire and
        // forget — the caller's promise must not wait for (or reject with) the teardown.
        const stale = epoch !== this._epoch;
        if (stale) subscription.unsubscribe().catch(() => {});

        const handle: ClientSubscription = {
          unsubscribe: async (): Promise<void> => {
            try {
              await subscription.unsubscribe();
            } finally {
              this._active.delete(handle);
            }
          },
          // Lazily materialized like the WebSocket transport's own: the common path allocates no
          // AbortController, and a first access after the failure observes the recorded reason.
          get failureSignal(): AbortSignal {
            const inner = subscription.failureSignal;
            if (inner !== undefined) return inner;
            if (failureController === undefined) {
              failureController = new AbortController();
              if (failure !== undefined) failureController.abort(failure);
            }
            return failureController.signal;
          },
        };
        tracked = handle;
        if (!stale) this._active.add(handle);
        return handle;
      });
  }

  /**
   * Unsubscribes every confirmed subscription concurrently and clears the registry. Handles
   * removed individually or by a failure are not revisited; subscribe calls still awaiting their
   * confirmation are retired as they land (see {@linkcode SubscriptionTracker._epoch}).
   */
  async unsubscribeAll(): Promise<void> {
    this._epoch++;
    const active = [...this._active];
    this._active.clear();
    await Promise.all(active.map((subscription) => subscription.unsubscribe()));
  }
}

/** Shared trackers, one per transport instance: teardown scope is the transport, not the client. */
const trackers = new WeakMap<ISubscriptionTransport, SubscriptionTracker>();

/** Returns the shared {@linkcode SubscriptionTracker} for `transport`, creating it on first use. */
export function trackerFor(transport: ISubscriptionTransport): SubscriptionTracker {
  let tracker = trackers.get(transport);
  if (tracker === undefined) trackers.set(transport, (tracker = new SubscriptionTracker(transport)));
  return tracker;
}
