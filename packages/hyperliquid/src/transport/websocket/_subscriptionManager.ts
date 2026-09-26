/**
 * Subscription lifecycle manager: tracks listeners per subscription payload,
 * resubscribes on reconnect, and enforces Hyperliquid's per-IP subscription limits.
 *
 * The limits are enforced against a {@linkcode WebSocketQuota} shared with every other
 * connection to the same deployment, because that is the scope the server counts in.
 *
 * @module
 */

import { ReconnectingWebSocket } from "./_reconnectingSocket.ts";
import * as abort from "../_abort.ts";
import type { ISubscription } from "../_base.ts";
import type { HyperliquidEventTarget } from "./_events.ts";
import { type WebSocketDispatcher, WebSocketRequestError } from "./_dispatcher.ts";
import { normalize } from "./_id.ts";
import { WebSocketQuota } from "./_quota.ts";
import { payloadEventType } from "./_routing.ts";

/** A live reference to a registration: one per subscribing call, until its waiter settles or its handle unsubscribes. */
interface RegistrationHandle {
  /** The call's error callback, invoked on subscription failure only while this lease is live. */
  onError?: (error: WebSocketRequestError) => void;
  /**
   * Whether this lease's `subscribe()` call resolved with the subscription live. Each lease
   * observes a failure through exactly one stage: the pending `subscribe()` promise rejects
   * before that (an unconfirmed lease never became a subscriber — its `onError` does not fire,
   * and no handle carrying a `failureSignal` was ever returned, so nothing dangles), while
   * every live confirmed lease gets its `onError` call and its `failureSignal` abort after.
   */
  confirmed: boolean;
  /**
   * Lazily created controller behind the returned handle's `failureSignal`: most subscribers
   * never read the signal, so the common path allocates no AbortController. `_failSubscription`
   * aborts it (with the failure as reason) for a live confirmed lease; a voluntary
   * `unsubscribe()` leaves it untouched.
   */
  failureController?: AbortController;
  /**
   * The failure this live confirmed lease was torn down with, recorded by `_failSubscription`
   * so a `failureSignal` first accessed after the failure is created already aborted with the
   * same reason a pre-failure access would have observed. Never set on a lease that retired
   * voluntarily before the failure — its signal must stay inert.
   */
  failure?: WebSocketRequestError;
}

/** Per-listener registration: its routed event type, live leases, and confirmation state. */
interface ListenerRegistration {
  /**
   * Event type this listener is attached to, derived from its own call's channel and payload.
   *
   * Stored per registration rather than per subscription: distinct channels can share one payload
   * id — `activeAssetCtx` and `activeSpotAssetCtx` send the identical `{type:"activeAssetCtx",…}`
   * payload, so the server serves both from a single subscription — and a listener joining such an
   * entry must receive its own channel's frames, not the channel of the call that created it.
   */
  eventType: string;
  /**
   * Live per-call leases on this registration: pending `subscribe()` waiters plus returned
   * handles, keyed by identity (a shared callback ref is safe). A call adds one
   * synchronously on attach and removes it when its waiter settles or its handle's
   * `unsubscribe()` runs; the registration is retired when the last lease goes away. An
   * aborting waiter can therefore never roll back a registration an identical joiner still
   * awaits, and one handle's `unsubscribe()` cannot cut off another live handle.
   *
   * A failure notifies every live confirmed lease — each one's `onError` and `failureSignal`,
   * once per `subscribe()` call — and never a dead or unconfirmed lease's; see
   * `_failSubscription`.
   */
  handles: Set<RegistrationHandle>;
}

/** Internal state for managing a subscription. */
interface SubscriptionState {
  /**
   * Snapshot of the subscription payload, taken once at subscribe time as `normalize(payload)` —
   * the normalized form the server echoes back.
   *
   * The reconnect and teardown paths re-issue and report this copy: the caller still owns the
   * object it passed, and mutating `payload.coin`/`payload.user` after subscribing must not
   * corrupt what unsubscribe sends or what a reconnect re-subscribes, while the registry key,
   * the routed event type, and the user refcount all still reflect the original.
   */
  payload: unknown;
  /**
   * The user this subscription counts against, resolved once at subscribe time from
   * {@linkcode SubscriptionState.payload}, so the refcount increment and decrement always
   * hit the same key.
   */
  user: string | undefined;
  /**
   * Registrations per event listener, keyed by routed event type within each listener.
   *
   * Nested by event type because one callback can subscribe through several channels that
   * share a payload id — `activeAssetCtx` and `activeSpotAssetCtx` send the identical
   * `{type:"activeAssetCtx",…}` payload, so both calls land on this one entry, and each must
   * attach (and later detach) its own channel's registration independently.
   */
  listeners: Map<(data: CustomEvent) => void, Map<string, ListenerRegistration>>;
  /** Promise tracking the subscription request. */
  promise: Promise<unknown>;
  /** Whether the subscription request has completed. */
  promiseFinished: boolean;
  /**
   * The failure this subscription was torn down with, recorded by `_failSubscription` so a
   * joiner whose confirmation continuation runs after the teardown can reject with it
   * instead of resolving a handle into the dead subscription.
   */
  failure?: WebSocketRequestError;
}

/** Lowercased `user` of a subscription payload, or `undefined` when the payload tracks no user. */
function userOf(payload: unknown): string | undefined {
  return typeof payload === "object" && payload !== null && "user" in payload && typeof payload.user === "string"
    ? payload.user.toLowerCase()
    : undefined;
}

/** Tracks listeners per subscription payload, resubscribes on reconnect, enforces server-side limits. */
export class WebSocketSubscriptionManager {
  /** Enable automatic re-subscription to Hyperliquid subscription after reconnection. */
  resubscribe: boolean;

  private readonly _socket: ReconnectingWebSocket;
  private readonly _dispatcher: WebSocketDispatcher;
  private readonly _hlEvents: HyperliquidEventTarget;
  private _subscriptions: Map<string, SubscriptionState> = new Map();
  /**
   * The per-IP budget this connection draws from.
   *
   * Subscription and unique-user counts live here rather than on the manager because the
   * server counts them per IP, across every connection from this host — a manager-local
   * count admitted N x 1000 subscriptions against a limit of 1000. See {@linkcode WebSocketQuota}.
   */
  private readonly _quota: WebSocketQuota;

  constructor(
    socket: ReconnectingWebSocket,
    dispatcher: WebSocketDispatcher,
    hlEvents: HyperliquidEventTarget,
    resubscribe: boolean,
    quota: WebSocketQuota = new WebSocketQuota(),
  ) {
    this._socket = socket;
    this._dispatcher = dispatcher;
    this._hlEvents = hlEvents;
    this.resubscribe = resubscribe;
    this._quota = quota;

    socket.addEventListener("open", () => this._handleOpen());
    socket.addEventListener("close", () => this._handleClose());
    socket.addEventListener("error", () => this._handleClose());
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Subscribes to a Hyperliquid event channel.
   *
   * @param options.signal Stops waiting for the confirmation and detaches the listener.
   * @param options.onError Callback invoked at most once per `subscribe()` call, when an already confirmed subscription fails:
   *                        - the server rejects a re-subscription after a reconnect;
   *                        - the connection is permanently terminated;
   *                        - the connection goes down while re-subscription is disabled.
   *
   *                        When several calls share one underlying subscription, every caller's callback fires.
   *                        Failures before the confirmation reject the `subscribe()` promise instead.
   *                        After the callback fires, the subscription is removed and no further events or errors follow.
   * @return A handle whose `failureSignal` aborts with the same failure `onError` reports — and
   *         never on a voluntary `unsubscribe()` — so a subscriber without `onError` still
   *         observes a dying feed.
   *
   * @throws {WebSocketRequestError} When the subscription request fails or limits are exceeded.
   */
  async subscribe<T>(
    channel: string,
    payload: unknown,
    listener: (data: CustomEvent<T>) => void,
    options?: {
      signal?: AbortSignal;
      onError?: (error: WebSocketRequestError) => void;
    },
  ): Promise<ISubscription> {
    const { signal, onError } = options ?? {};
    if (signal?.aborted) {
      throw new WebSocketRequestError("Subscription was aborted", { cause: signal.reason, request: payload });
    }
    // `normalize()` returns a fresh deep copy of the payload in the normalized form the server
    // echoes, so the id is its serialization and the snapshot for a new subscription is already
    // in hand — no stringify/parse round-trip.
    const snapshot = normalize(payload);
    const id = JSON.stringify(snapshot);
    // The routed event type belongs to this call, not to the subscription entry: an entry keyed
    // by payload id alone can serve several channels (see {@linkcode ListenerRegistration.eventType}),
    // so every listener attaches to — and later detaches from — its own call's routed type.
    const eventType = payloadEventType(channel, payload);

    // --- Subscription state --------------------------------------------------
    let subscription = this._subscriptions.get(id);
    if (!subscription) {
      // Reserved against the shared per-IP budget before the request goes out. The reservation
      // is released again by `_deleteSubscription` on every exit path — unsubscribe, refusal,
      // disconnect — so an abandoned subscribe never leaks a slot to the other connections.
      const user = userOf(snapshot);
      const refusal = this._quota.reserveSubscription(user);
      if (refusal === "subscriptions") {
        throw new WebSocketRequestError(`Cannot subscribe to more than ${this._quota.maxSubscriptions} channels.`, {
          request: payload,
        });
      }
      if (refusal === "users") {
        throw new WebSocketRequestError(`Cannot track more than ${this._quota.maxUniqueUsers} total users.`, {
          request: payload,
        });
      }

      // The snapshot doubles as the normalized wire payload; the id is handed over with it so
      // the dispatcher skips its own normalize of the subscription subtree.
      const promise = this._dispatcher
        .request("subscribe", snapshot, undefined, { subscriptionId: id })
        .finally(() => (created.promiseFinished = true));
      const created: SubscriptionState = {
        payload: snapshot,
        user,
        listeners: new Map(),
        promise,
        promiseFinished: false,
      };
      this._addSubscription(id, created);
      subscription = created;

      // Each subscriber awaits this promise through its own abort.race below,
      // and an aborting subscriber stops awaiting early. If every subscriber
      // aborts before the request settles, a later rejection would have no
      // handler left and crash the process as an unhandled rejection; this
      // no-op handler absorbs exactly that case.
      promise.catch(() => {});
    }

    // --- Listener registration -----------------------------------------------
    let registration = subscription.listeners.get(listener)?.get(eventType);
    if (!registration) {
      this._hlEvents.addEventListener(eventType, listener);
      registration = { eventType, handles: new Set() };
      let bucket = subscription.listeners.get(listener);
      if (bucket === undefined) subscription.listeners.set(listener, (bucket = new Map()));
      bucket.set(eventType, registration);
    }
    // Claimed synchronously, before any await: a concurrent unsubscribe of another handle
    // must observe this call's lease and leave the registration live.
    const handle: RegistrationHandle = { onError, confirmed: false };
    registration.handles.add(handle);

    // Each call gets its own unsubscribe: Set.delete by identity makes a stale call a
    // no-op, and the identity check inside _retireRegistration keeps it from touching a
    // later registration that reused this one's slot.
    const unsubscribe = async (): Promise<void> => {
      if (!registration.handles.delete(handle)) return;
      if (registration.handles.size > 0) return;
      await this._retireRegistration(id, subscription, listener, registration, true);
    };

    // --- Server confirmation -------------------------------------------------
    try {
      await abort.race(subscription.promise, signal);
      // The request settled, but a synchronous teardown (terminate, refused re-subscribe)
      // may have run while this continuation was queued: re-verify that the subscription,
      // the registration, and this lease are all still live before resolving a handle
      // into them — an unconfirmed joiner must never resolve into a dead subscription.
      if (
        this._subscriptions.get(id) !== subscription ||
        subscription.listeners.get(listener)?.get(eventType) !== registration ||
        !registration.handles.has(handle)
      ) {
        throw (
          subscription.failure ??
          new WebSocketRequestError("Subscription was lost before the confirmation completed", { request: payload })
        );
      }
      handle.confirmed = true;
    } catch (error) {
      // Roll back only what this call still owns: the subscription entry itself may
      // legitimately survive (a re-subscription rejected by a disconnect is retried on
      // the next open), and the registration itself survives while other waiters or
      // handles reference it — an abort is private to its caller, a failure is shared.
      registration.handles.delete(handle);
      if (registration.handles.size === 0) {
        // On abort the shared request stays in flight and may still confirm: free the
        // server-side slot nobody is listening to. On failure there is nothing to free.
        const aborted = signal !== undefined && error === signal.reason;
        this._retireRegistration(id, subscription, listener, registration, aborted)?.catch(() => {});
      }
      if (signal && error === signal.reason) {
        throw new WebSocketRequestError("Subscription was aborted", { cause: error, request: payload });
      }
      throw error;
    }

    return {
      unsubscribe,
      // Lazily materialized: most subscribers never read the signal, so the common path pays
      // no AbortController per call. Repeat accesses return the same signal object; a first
      // access after the failure creates the controller already aborted with the recorded
      // reason, indistinguishable from one aborted while being observed.
      get failureSignal(): AbortSignal {
        let controller = handle.failureController;
        if (controller === undefined) {
          controller = handle.failureController = new AbortController();
          if (handle.failure !== undefined) controller.abort(handle.failure);
        }
        return controller.signal;
      },
    };
  }

  // ===========================================================================
  // Event handlers
  // ===========================================================================

  /** Resubscribes to every completed subscription when the socket re-opens. */
  private _handleOpen(): void {
    // Snapshot before iterating: _failSubscription mutates `_subscriptions`.
    for (const [id, subscription] of [...this._subscriptions.entries()]) {
      if (!subscription.promiseFinished) continue;

      // A subscription that survived a disconnect cannot be served when
      // re-subscription was disabled while the socket was down.
      if (!this.resubscribe) {
        this._failSubscription(
          id,
          subscription,
          new WebSocketRequestError("WebSocket connection closed", { request: subscription.payload }),
        );
        continue;
      }

      const promise = this._dispatcher.request("subscribe", subscription.payload, undefined, { subscriptionId: id });
      subscription.promise = promise;
      subscription.promiseFinished = false;

      promise
        .catch((error) => {
          // A rejection on a live socket means the server refused the
          // re-subscription or it timed out — either way the channel cannot be
          // trusted anymore. A rejection on a dead socket is the disconnect
          // clearing the queue; the next open retries.
          if (this._socket.readyState === ReconnectingWebSocket.OPEN) {
            // The dispatcher rejects only with WebSocketRequestError.
            this._failSubscription(id, subscription, error as WebSocketRequestError);
          }
        })
        .finally(() => (subscription.promiseFinished = true));
    }
  }

  /**
   * Fails every subscription when the connection stops serving them: the socket is
   * terminated, or it closes while re-subscription is disabled.
   */
  private _handleClose(): void {
    const terminal = this._socket.terminationSignal.aborted;
    if (this.resubscribe && !terminal) return;

    // Snapshot before teardown: each call mutates `_subscriptions` during iteration.
    for (const [id, subscription] of [...this._subscriptions.entries()]) {
      const error = terminal
        ? new WebSocketRequestError("WebSocket connection permanently terminated", {
            cause: this._socket.terminationSignal.reason,
            request: subscription.payload,
          })
        : new WebSocketRequestError("WebSocket connection closed", { request: subscription.payload });
      this._failSubscription(id, subscription, error);
    }
  }

  // ===========================================================================
  // Registry
  // ===========================================================================

  /**
   * Registers a subscription whose quota slot the caller has already reserved.
   *
   * The reservation happens in `subscribe()` rather than here, because it must run — and be
   * able to refuse — before the subscribe request is put on the wire.
   */
  private _addSubscription(id: string, subscription: SubscriptionState): void {
    this._subscriptions.set(id, subscription);
  }

  /** Removes a subscription and returns its slot to the shared per-IP budget. */
  private _deleteSubscription(id: string): void {
    const subscription = this._subscriptions.get(id);
    if (subscription === undefined) return;
    this._subscriptions.delete(id);
    this._quota.releaseSubscription(subscription.user);
  }

  /**
   * Retires a registration whose last reference is gone: detaches the listener and removes
   * the registration, then — when it was the subscription's last — deletes the subscription
   * and, for `wireUnsubscribe`, returns the wire unsubscribe request.
   *
   * Identity-checked: the registration must still be the one stored for its
   * listener/eventType pair, so a stale closure targeting an already-retired registration
   * (e.g. a handle whose slot a later subscribe re-used) is a no-op.
   */
  private _retireRegistration(
    id: string,
    subscription: SubscriptionState,
    listener: (data: CustomEvent) => void,
    registration: ListenerRegistration,
    wireUnsubscribe: boolean,
  ): Promise<unknown> | undefined {
    if (this._subscriptions.get(id) !== subscription) return undefined;
    const bucket = subscription.listeners.get(listener);
    if (bucket?.get(registration.eventType) !== registration) return undefined;

    this._hlEvents.removeEventListener(registration.eventType, listener);
    bucket.delete(registration.eventType);
    if (bucket.size === 0) subscription.listeners.delete(listener);
    if (subscription.listeners.size > 0) return undefined;

    this._deleteSubscription(id);
    if (wireUnsubscribe && this._socket.readyState === ReconnectingWebSocket.OPEN) {
      return this._dispatcher.request("unsubscribe", subscription.payload, undefined, { subscriptionId: id });
    }
    return undefined;
  }

  // ===========================================================================
  // Teardown
  // ===========================================================================

  /**
   * Removes the subscription with all its listeners, then notifies every live
   * confirmed lease: aborts its `failureSignal` and invokes its `onError`, each
   * callback isolated so one throwing `onError` cannot silence the rest.
   * Sends nothing to the server: every caller deals with a subscription the
   * server no longer serves — refused, or cut off by a close.
   */
  private _failSubscription(id: string, subscription: SubscriptionState, error: WebSocketRequestError): void {
    if (this._subscriptions.get(id) !== subscription) return;
    this._deleteSubscription(id);
    // Recorded for joiners whose confirmation continuation is still queued: they reject
    // with this failure instead of resolving a handle into the dead subscription.
    subscription.failure = error;

    // Pass 1 — detach listeners and snapshot every live confirmed lease, recording the
    // failure on each BEFORE any user code runs. Both notification channels invoke user
    // code synchronously (`AbortController.abort` runs abort listeners, `onError` is a
    // callback), and that code can re-enter `unsubscribe()` on a sibling lease — mutating
    // `registration.handles` mid-iteration would then skip a lease that was live at
    // failure time. The snapshot fixes the notified set at exactly that moment, and the
    // pre-recorded failure means a `failureSignal` first accessed inside an earlier
    // callback already observes the reason, whichever lease it belongs to.
    const confirmed: RegistrationHandle[] = [];
    for (const [listener, registrations] of subscription.listeners) {
      for (const registration of registrations.values()) {
        this._hlEvents.removeEventListener(registration.eventType, listener);
        // Every live confirmed lease is notified, through both of its channels. Unconfirmed
        // leases observe the failure through their subscribe() rejection; dead leases were
        // removed from the set already.
        for (const handle of registration.handles) {
          if (!handle.confirmed) continue;
          handle.failure = error;
          confirmed.push(handle);
        }
      }
    }

    // Pass 2 — notify off the snapshot. A lease another callback retired mid-teardown is
    // still notified: it was live when the subscription died, and its `unsubscribe()`
    // against the already-removed subscription was a no-op, not a disavowal of the failure.
    for (const handle of confirmed) {
      handle.failureController?.abort(error);
      try {
        handle.onError?.(error);
      } catch {
        // A throwing onError must not affect the other leases or listeners.
      }
    }
  }
}
