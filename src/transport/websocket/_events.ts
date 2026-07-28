/**
 * Typed event target for Hyperliquid WebSocket messages.
 *
 * The frame types below are a trusted contract with the server: handlers
 * consume them without re-validating the shape.
 *
 * @module
 */

import { frameEventType, isBareChannel } from "./_routing.ts";

/**
 * Confirmation frame of a `subscribe` / `unsubscribe` request.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
 */
export interface SubscribeUnsubscribeResponse {
  method: "subscribe" | "unsubscribe";
  /** Subscription payload echoed by the server: normalized, possibly with server-added fields. */
  subscription: unknown;
}

/**
 * Response frame of a `post` request.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/post-requests
 */
export interface PostResponse {
  id: number;
  response:
    | {
        type: "info";
        payload: { type: string; data: unknown };
      }
    | {
        type: "action";
        payload: {
          status: "ok" | "err";
          response: { type: string; data?: unknown } | string;
        };
      }
    | {
        type: "error";
        /** Error message, e.g. "Cannot track more than 15 total users." */
        payload: string;
      };
}

/**
 * Block summary pushed by the explorer RPC.
 *
 * @see null
 */
interface BlockDetails {
  blockTime: number;
  hash: string;
  height: number;
  numTxs: number;
  proposer: string;
}

/**
 * Transaction details pushed by the explorer RPC.
 *
 * @see null
 */
interface TxDetails {
  action: {
    type: string;
    [key: string]: unknown;
  };
  block: number;
  error: string | null;
  hash: string;
  time: number;
  user: string;
}

/** Base system events and dynamic channel events for the Hyperliquid WebSocket API. */
interface HyperliquidEventMap {
  subscriptionResponse: CustomEvent<SubscribeUnsubscribeResponse>;
  post: CustomEvent<PostResponse>;
  /** Error text; any embedded `{…}` body is valid JSON. */
  error: CustomEvent<string>;
  pong: CustomEvent<undefined>;
  explorerBlock_: CustomEvent<BlockDetails[]>;
  explorerTxs_: CustomEvent<TxDetails[]>;
  // deno-lint-ignore no-explicit-any
  [key: string]: CustomEvent<any>;
}

/** Matches the `{ channel, data? }` envelope; `pong` is the only frame without `data`. */
function isHyperliquidEvent(msg: unknown): msg is { channel: string; data?: unknown } {
  return typeof msg === "object" && msg !== null && "channel" in msg && typeof msg.channel === "string";
}

// The explorer RPC pushes raw arrays without a { channel, data } envelope:
// detect them by shape and route them to synthetic "_"-suffixed channels.
function isExplorerBlockEvent(msg: unknown): msg is BlockDetails[] {
  return (
    Array.isArray(msg) &&
    msg.length > 0 &&
    typeof msg[0] === "object" &&
    msg[0] !== null &&
    "blockTime" in msg[0] &&
    "hash" in msg[0] &&
    "height" in msg[0] &&
    "numTxs" in msg[0] &&
    "proposer" in msg[0]
  );
}

function isExplorerTxsEvent(msg: unknown): msg is TxDetails[] {
  return (
    Array.isArray(msg) &&
    msg.length > 0 &&
    typeof msg[0] === "object" &&
    msg[0] !== null &&
    "action" in msg[0] &&
    "block" in msg[0] &&
    "error" in msg[0] &&
    "hash" in msg[0] &&
    "time" in msg[0] &&
    "user" in msg[0]
  );
}

/**
 * Listens for WebSocket messages and re-dispatches them as typed Hyperliquid events.
 *
 * Only `removeEventListener` is typed here; `addEventListener` carries its typed overload on the
 * class itself, because it needs a body (see {@linkcode HyperliquidEventTarget.addEventListener})
 * and a member cannot be declared on both the class and its merged interface.
 *
 * @example
 * ```ts ignore
 * const hlEvents = new HyperliquidEventTarget(socket);
 * hlEvents.addEventListener("l2Book", (event) => {
 *   event.detail; // data of every '{"channel":"l2Book","data":{...}}' frame
 * });
 * ```
 */
export interface HyperliquidEventTarget {
  removeEventListener<K extends keyof HyperliquidEventMap>(
    type: K,
    listener: ((event: HyperliquidEventMap[K]) => void) | EventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
}

/**
 * Lightweight event shell handed to listeners. Only `type` and `detail` are populated — every
 * Hyperliquid consumer in this package (and every public subscription listener) reads those two
 * fields and nothing else. Reusing one shell per target avoids a `CustomEvent` allocation on every
 * frame; listeners must not retain the object across turns (treat it as valid only during the call).
 */
interface EventShell {
  type: string;
  detail: unknown;
}

/**
 * Listeners registered for one event type: the listener itself while there is exactly one, a
 * copy-on-write array once there are more.
 */
type Listeners = EventListenerOrEventListenerObject | EventListenerOrEventListenerObject[];

/**
 * Re-dispatches every frame as a typed event.
 *
 * On the channels `_routing.ts` can key, the frame goes out on its routed type so a subscription
 * only runs for the frames it asked for; it additionally goes out on the bare channel whenever
 * something is listening there, which keeps broadcast semantics for unroutable frames, unrouted
 * channels and unkeyed subscriptions.
 *
 * Dispatch is implemented with a direct listener map rather than `EventTarget.dispatchEvent`: a
 * `CustomEvent` per frame was the dominant cost of multi-subscription fan-out after routing already
 * cut invocations to one. Listeners still receive an object with `type` and `detail` (the only
 * fields they read); throws are swallowed per listener so one bad callback cannot starve the rest
 * or kill the process (Bun/Node raise uncaught listener errors, unlike the DOM).
 */
export class HyperliquidEventTarget {
  /**
   * Channels that have ever had a listener on their bare name, so a routed frame knows it still
   * owes them a broadcast.
   *
   * Entries are never removed: the set exists only to skip a dispatch nobody would observe, so a
   * stale entry costs one such dispatch, while a missing entry would silently drop frames. Growth
   * is bounded by the number of channels.
   */
  private readonly _bareChannels: Set<string> = new Set();

  /**
   * Live listeners per event type. The original listener reference is stored so
   * `removeEventListener` can match by identity the way `EventTarget` does.
   *
   * A lone listener is stored unboxed and only promoted to an array on the second registration —
   * one listener per routed type is the common case after `_routing.ts` keys the channel, and the
   * unboxed form dispatches with a `typeof` check instead of a `Set` iterator. The arrays are
   * copy-on-write (see {@linkcode _addTo} / {@linkcode _removeFrom}), which is what lets `_emit`
   * iterate one by index with no defensive snapshot: a registration change during dispatch installs
   * a new array and leaves the one being walked untouched.
   */
  private readonly _listeners = new Map<string, Listeners>();

  /**
   * Single recycled event shell. Filled in immediately before each listener call and valid only for
   * the duration of that call — see {@linkcode EventShell}.
   */
  private readonly _shell: EventShell = { type: "", detail: undefined };

  /**
   * Bumped by every registration change. `_emit` snapshots it and re-checks liveness only when it
   * moves, so the common dispatch (nobody subscribes or unsubscribes from inside a callback) pays
   * one integer compare per listener instead of a lookup.
   */
  private _generation = 0;

  addEventListener<K extends keyof HyperliquidEventMap>(
    type: K,
    listener: ((event: HyperliquidEventMap[K]) => void) | EventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** Records bare-channel registrations and stores the listener for direct dispatch. */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener === null) return;
    if (isBareChannel(type)) this._bareChannels.add(type);

    // `once` is rare on this path (the package never uses it for Hyperliquid frames) but the
    // EventTarget contract still requires it: wrap so the first firing removes the wrapper.
    let registered: EventListenerOrEventListenerObject = listener;
    if (typeof options === "object" && options !== null && options.once === true) {
      const onceWrapper: EventListener = (event: Event) => {
        this.removeEventListener(type, onceWrapper);
        if (typeof listener === "function") listener.call(this, event);
        else listener.handleEvent(event);
      };
      registered = onceWrapper;
    }

    this._addTo(type, registered);

    // AbortSignal (when provided) detaches the same way EventTarget would.
    if (typeof options === "object" && options !== null && options.signal !== undefined) {
      const signal = options.signal;
      if (signal.aborted) {
        this.removeEventListener(type, registered);
        return;
      }
      signal.addEventListener("abort", () => this.removeEventListener(type, registered), { once: true });
    }
  }

  /**
   * Registers `listener` for `type`, ignoring an exact duplicate the way `EventTarget` does.
   *
   * Writes a fresh array rather than mutating in place so an in-flight `_emit` keeps walking the
   * registration list it started with.
   */
  private _addTo(type: string, listener: EventListenerOrEventListenerObject): void {
    const entry = this._listeners.get(type);
    if (entry === undefined) {
      this._listeners.set(type, listener);
      this._generation++;
      return;
    }
    if (!Array.isArray(entry)) {
      if (entry === listener) return; // duplicate registration is a no-op
      this._listeners.set(type, [entry, listener]);
      this._generation++;
      return;
    }
    if (entry.indexOf(listener) !== -1) return;
    this._listeners.set(type, [...entry, listener]);
    this._generation++;
  }

  /** Whether `listener` is still registered for `type` right now. */
  private _isLive(type: string, listener: EventListenerOrEventListenerObject): boolean {
    const entry = this._listeners.get(type);
    if (entry === undefined) return false;
    return Array.isArray(entry) ? entry.indexOf(listener) !== -1 : entry === listener;
  }

  /** Removes a previously registered listener by identity. */
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: boolean | EventListenerOptions,
  ): void {
    if (listener === null) return;
    const entry = this._listeners.get(type);
    if (entry === undefined) return;

    if (!Array.isArray(entry)) {
      if (entry === listener) {
        this._listeners.delete(type);
        this._generation++;
      }
      return;
    }

    const i = entry.indexOf(listener);
    if (i === -1) return;
    // Copy-on-write: an `_emit` walking the old array must not see it shrink mid-dispatch.
    if (entry.length === 2) this._listeners.set(type, entry[i === 0 ? 1 : 0]!);
    else this._listeners.set(type, [...entry.slice(0, i), ...entry.slice(i + 1)]);
    this._generation++;
  }

  /**
   * Invokes every listener registered for `type` with a recycled shell carrying `detail`.
   *
   * The lone-listener case (the common one after per-coin routing) dispatches straight off the map
   * entry. Multi-listener types walk their array by index: the array is copy-on-write, so a listener
   * that adds or removes a registration mid-dispatch swaps in a new array and cannot make this loop
   * skip or double-fire a sibling.
   */
  private _emit(type: string, detail: unknown): void {
    const entry = this._listeners.get(type);
    if (entry === undefined) return;

    const shell = this._shell;
    shell.type = type;
    shell.detail = detail;
    // Cast: listeners are typed as CustomEvent handlers but only ever read `type`/`detail`.
    const event = shell as unknown as Event;

    if (typeof entry === "function") {
      try {
        entry.call(this, event);
      } catch {
        // Swallowed: one bad listener (or one bad frame) must not abort the dispatch.
      }
      return;
    }
    if (!Array.isArray(entry)) {
      try {
        entry.handleEvent(event);
      } catch {
        // Swallowed: see above.
      }
      return;
    }

    const generation = this._generation;
    for (let i = 0; i < entry.length; i++) {
      const listener = entry[i]!;
      // An earlier callback in this same dispatch may have unsubscribed this one; `EventTarget`
      // would not deliver to it. The generation check keeps the common case (no registration
      // change mid-dispatch) at one integer compare.
      if (this._generation !== generation && !this._isLive(type, listener)) continue;
      try {
        if (typeof listener === "function") listener.call(this, event);
        else listener.handleEvent(event);
      } catch {
        // Swallowed: one bad listener must not starve the remaining ones.
      }
    }
  }

  constructor(socket: WebSocket) {
    const internal = socket as { _onFrame?: ((data: unknown) => void) | undefined };
    if ("_onFrame" in internal) {
      // `ReconnectingWebSocket` exposes a direct frame hook: taking it skips a `MessageEvent`
      // allocation and an `EventTarget.dispatchEvent` per frame, on the hottest path in the SDK.
      internal._onFrame = (data: unknown): void => this._handleFrame(data);
    } else {
      // Any other `WebSocket` (including test doubles) still works through the standard event.
      socket.addEventListener("message", (event) => this._handleFrame(event.data));
    }
  }

  /** Parses one raw inbound frame and dispatches it to the listeners that asked for it. */
  private _handleFrame(data: unknown): void {
    let msg: unknown;
    try {
      msg = JSON.parse(data as string);
    } catch {
      return; // Ignore non-JSON frames
    }

    if (isHyperliquidEvent(msg)) {
      // Routed first, then the channel itself unless nothing has ever listened there. A routing
      // mistake can therefore only ever cost an extra discarded call, never a missed frame.
      const routed = frameEventType(msg.channel, msg.data);
      if (routed !== undefined) {
        this._emit(routed, msg.data);
        if (!this._bareChannels.has(msg.channel)) return;
      }
      this._emit(msg.channel, msg.data);
    } else if (isExplorerBlockEvent(msg)) {
      this._emit("explorerBlock_", msg);
    } else if (isExplorerTxsEvent(msg)) {
      this._emit("explorerTxs_", msg);
    }
  }
}
