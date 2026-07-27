/**
 * Subscription lifecycle manager: tracks listeners per subscription payload,
 * resubscribes on reconnect, and enforces per-connection subscription limits.
 *
 * @module
 */

import { ReconnectingWebSocket } from "./_reconnectingSocket.ts";
import * as abort from "../_abort.ts";
import type { ISubscription } from "../_base.ts";
import type { HyperliquidEventTarget } from "./_events.ts";
import { type WebSocketDispatcher, WebSocketRequestError } from "./_dispatcher.ts";
import { requestToId } from "./_id.ts";
import { payloadEventType } from "./_routing.ts";

/** A live reference to a registration: one per subscribing call, until its waiter settles or its handle unsubscribes. */
interface RegistrationHandle {
  /** The call's error callback, invoked on subscription failure only while this lease is live. */
  onError?: (error: WebSocketRequestError) => void;
  /**
   * Whether this lease's `subscribe()` call resolved with the subscription live. A failure
   * is reported through exactly one channel: the pending `subscribe()` promise before that
   * (an unconfirmed lease never became a subscriber — its `onError` does not fire), the
   * first live confirmed lease's `onError` after.
   */
  confirmed: boolean;
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
   * Error ownership is first-live-owner: the first live confirmed lease in insertion order
   * owns the failure callback, and when it retires the next live lease promotes — a failure
   * fires exactly one `onError`, never a dead lease's.
   */
  handles: Set<RegistrationHandle>;
}

/** Internal state for managing a subscription. */
interface SubscriptionState {
  /**
   * Snapshot of the subscription payload, taken once at subscribe time as
   * `JSON.parse(requestToId(payload))` — the normalized form the server echoes back.
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

/**
 * Maximum number of subscriptions; the server rejects the excess without
 * echoing the request, so the guard must run client-side.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
 */
const MAX_SUBSCRIPTIONS = 1000;

/**
 * Maximum number of unique users across subscriptions; the server rejects the
 * excess without echoing the request, so the guard must run client-side.
 *
 * The official docs say 10 (updated ~17 days before the probe), but a live
 * mainnet probe on 2026-07-26 observed the server accepting 15 users and
 * rejecting the 16th with an `error` frame "Cannot track more than 15 total
 * users." — the server is the authority here and the docs lag. The rejection
 * carries no echoed request, so it cannot be matched to the pending subscribe
 * and would surface only via the request timeout — another reason the
 * client-side guard must fire first.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
 */
const MAX_UNIQUE_USERS = 15;

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
   * Live subscription count per tracked user, maintained incrementally so the unique-user guard
   * stays O(1) per subscribe instead of rescanning (and re-parsing) every registered id.
   */
  private readonly _users: Map<string, number> = new Map();

  constructor(
    socket: ReconnectingWebSocket,
    dispatcher: WebSocketDispatcher,
    hlEvents: HyperliquidEventTarget,
    resubscribe: boolean,
  ) {
    this._socket = socket;
    this._dispatcher = dispatcher;
    this._hlEvents = hlEvents;
    this.resubscribe = resubscribe;

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
   * @param options.onError Callback invoked at most once, when an already confirmed subscription fails:
   *                        - the server rejects a re-subscription after a reconnect;
   *                        - the connection is permanently terminated;
   *                        - the connection goes down while re-subscription is disabled.
   *
   *                        Failures before the confirmation reject the `subscribe()` promise instead.
   *                        After the callback fires, the subscription is removed and no further events or errors follow.
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
    const id = requestToId(payload);
    // The routed event type belongs to this call, not to the subscription entry: an entry keyed
    // by payload id alone can serve several channels (see {@linkcode ListenerRegistration.eventType}),
    // so every listener attaches to — and later detaches from — its own call's routed type.
    const eventType = payloadEventType(channel, payload);

    // --- Subscription state --------------------------------------------------
    let subscription = this._subscriptions.get(id);
    if (!subscription) {
      if (this._subscriptions.size >= MAX_SUBSCRIPTIONS) {
        throw new WebSocketRequestError(`Cannot subscribe to more than ${MAX_SUBSCRIPTIONS} channels.`, {
          request: payload,
        });
      }
      if (this._exceedsUserLimit(payload)) {
        throw new WebSocketRequestError(`Cannot track more than ${MAX_UNIQUE_USERS} total users.`, {
          request: payload,
        });
      }

      // Snapshot the payload in the normalized form the server echoes: the id already holds it
      // as a string, so parsing it back costs one parse per new subscription.
      const snapshot: unknown = JSON.parse(id);
      const promise = this._dispatcher.request("subscribe", snapshot).finally(() => (created.promiseFinished = true));
      const created: SubscriptionState = {
        payload: snapshot,
        user: userOf(snapshot),
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

    return { unsubscribe };
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

      const promise = this._dispatcher.request("subscribe", subscription.payload);
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

  /** Registers a subscription and counts its user towards the unique-user limit. */
  private _addSubscription(id: string, subscription: SubscriptionState): void {
    this._subscriptions.set(id, subscription);
    const user = subscription.user;
    if (user !== undefined) this._users.set(user, (this._users.get(user) ?? 0) + 1);
  }

  /** Removes a subscription and releases its user from the unique-user count. */
  private _deleteSubscription(id: string): void {
    const subscription = this._subscriptions.get(id);
    if (subscription === undefined) return;
    this._subscriptions.delete(id);

    const user = subscription.user;
    if (user === undefined) return;
    const count = this._users.get(user);
    // The count is only ever absent if a registration was lost, in which case forgetting the user
    // is the safe direction: the server rejects a genuine overflow, a stuck count would not.
    if (count === undefined || count <= 1) this._users.delete(user);
    else this._users.set(user, count - 1);
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
      return this._dispatcher.request("unsubscribe", subscription.payload);
    }
    return undefined;
  }

  // ===========================================================================
  // Teardown
  // ===========================================================================

  /**
   * Removes the subscription with all its listeners, then notifies each
   * confirmed listener's `onError` once. Sends nothing to the server: every
   * caller deals with a subscription the server no longer serves — refused,
   * or cut off by a close.
   */
  private _failSubscription(id: string, subscription: SubscriptionState, error: WebSocketRequestError): void {
    if (this._subscriptions.get(id) !== subscription) return;
    this._deleteSubscription(id);
    // Recorded for joiners whose confirmation continuation is still queued: they reject
    // with this failure instead of resolving a handle into the dead subscription.
    subscription.failure = error;

    for (const [listener, registrations] of subscription.listeners) {
      for (const registration of registrations.values()) {
        this._hlEvents.removeEventListener(registration.eventType, listener);
        // First-live-owner: exactly one live, confirmed lease — the first in insertion
        // order — is notified. Unconfirmed leases observe the failure through their
        // subscribe() rejection; dead leases were removed from the set already.
        for (const handle of registration.handles) {
          if (!handle.confirmed) continue;
          try {
            handle.onError?.(error);
          } catch {
            // A throwing onError must not affect other listeners.
          }
          break;
        }
      }
    }
  }

  // ===========================================================================
  // Subscription limit checks
  // ===========================================================================

  /** True when subscribing `payload` would track one user above the limit. */
  private _exceedsUserLimit(payload: unknown): boolean {
    const user = userOf(payload);
    if (user === undefined) return false;
    return !this._users.has(user) && this._users.size >= MAX_UNIQUE_USERS;
  }
}
