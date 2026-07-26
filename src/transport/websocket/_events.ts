/**
 * Typed event target for Hyperliquid WebSocket messages.
 *
 * The frame types below are a trusted contract with the server: handlers
 * consume them without re-validating the shape.
 *
 * @module
 */

import { CustomEvent_ } from "../_polyfills.ts";
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
 * Re-dispatches every frame as a typed event.
 *
 * On the channels `_routing.ts` can key, the frame goes out on its routed type so a subscription
 * only runs for the frames it asked for; it additionally goes out on the bare channel whenever
 * something is listening there, which keeps broadcast semantics for unroutable frames, unrouted
 * channels and unkeyed subscriptions.
 */
export class HyperliquidEventTarget extends EventTarget {
  /**
   * Channels that have ever had a listener on their bare name, so a routed frame knows it still
   * owes them a broadcast.
   *
   * Entries are never removed: the set exists only to skip an event allocation nobody would
   * observe, so a stale entry costs one such dispatch, while a missing entry would silently drop
   * frames. Growth is bounded by the number of channels.
   */
  private readonly _bareChannels: Set<string> = new Set();

  addEventListener<K extends keyof HyperliquidEventMap>(
    type: K,
    listener: ((event: HyperliquidEventMap[K]) => void) | EventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** Records bare-channel registrations, then registers the listener as `EventTarget` does. */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (isBareChannel(type)) this._bareChannels.add(type);
    super.addEventListener(type, listener, options);
  }

  constructor(socket: WebSocket) {
    super();
    socket.addEventListener("message", (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // Ignore non-JSON frames
      }

      if (isHyperliquidEvent(msg)) {
        // Routed first, then the channel itself unless nothing has ever listened there. A routing
        // mistake can therefore only ever cost an extra discarded call, never a missed frame.
        const routed = frameEventType(msg.channel, msg.data);
        if (routed !== undefined) {
          this.dispatchEvent(new CustomEvent_(routed, { detail: msg.data }));
          if (!this._bareChannels.has(msg.channel)) return;
        }
        this.dispatchEvent(new CustomEvent_(msg.channel, { detail: msg.data }));
      } else if (isExplorerBlockEvent(msg)) {
        this.dispatchEvent(new CustomEvent_("explorerBlock_", { detail: msg }));
      } else if (isExplorerTxsEvent(msg)) {
        this.dispatchEvent(new CustomEvent_("explorerTxs_", { detail: msg }));
      }
    });
  }
}
