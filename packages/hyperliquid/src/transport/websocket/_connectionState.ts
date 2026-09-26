/**
 * Connection-state tracking for the WebSocket transport: reduces the socket's own
 * open/close/termination signals to a four-state lifecycle and re-dispatches transitions.
 * @module
 */

import type { ReconnectingWebSocket } from "./_reconnectingSocket.ts";

/**
 * Connection lifecycle state of a {@linkcode WebSocketTransport}:
 * - `connecting` — no connection yet: the initial attempt, or retrying before the first `open`.
 * - `connected` — the connection is open.
 * - `reconnecting` — the connection dropped after being open; reconnection is underway.
 * - `disconnected` — permanently terminated (`close()`, or the reconnection policy gave up); final.
 */
export type WebSocketConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

/** Event map of {@linkcode WebSocketConnectionEvents}. */
export interface WebSocketConnectionEventMap {
  /** Dispatched on every state transition; `detail` is the new state. */
  connectionstatechange: CustomEvent<WebSocketConnectionState>;
}

/**
 * Event target behind {@linkcode WebSocketTransport.events}: tracks the connection lifecycle and
 * dispatches a `connectionstatechange` event on every transition. See
 * {@linkcode WebSocketConnectionState} for the states.
 *
 * @example
 * ```ts
 * import { WebSocketTransport } from "@bloxwap/hyperliquid";
 *
 * const transport = new WebSocketTransport();
 * transport.events.addEventListener("connectionstatechange", (event) => {
 *   console.log(event.detail); // "connecting" | "connected" | "reconnecting" | "disconnected"
 * });
 * ```
 */
export class WebSocketConnectionEvents extends EventTarget {
  private _state: WebSocketConnectionState = "connecting";
  /** Whether a connection has ever opened; a close before the first open is still `connecting`. */
  private _everOpened = false;

  /** Current connection state. */
  get state(): WebSocketConnectionState {
    return this._state;
  }

  constructor(socket: ReconnectingWebSocket) {
    super();
    socket.addEventListener("open", () => {
      this._everOpened = true;
      this._setState("connected");
    });
    socket.addEventListener("close", () => {
      this._setState(
        socket.terminationSignal.aborted ? "disconnected" : this._everOpened ? "reconnecting" : "connecting",
      );
    });
    // Termination aborts the signal before the final close is dispatched — and when close() runs
    // inside a close listener, no further close is dispatched at all — so the abort is the
    // reliable "disconnected" trigger.
    socket.terminationSignal.addEventListener("abort", () => this._setState("disconnected"), { once: true });
  }

  /** Transitions to `state`, dispatching `connectionstatechange` only on an actual change. */
  private _setState(state: WebSocketConnectionState): void {
    if (state === this._state) return;
    this._state = state;
    this.dispatchEvent(new CustomEvent("connectionstatechange", { detail: state }));
  }

  addEventListener<K extends keyof WebSocketConnectionEventMap>(
    type: K,
    listener: (this: WebSocketConnectionEvents, ev: WebSocketConnectionEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  removeEventListener<K extends keyof WebSocketConnectionEventMap>(
    type: K,
    listener: (this: WebSocketConnectionEvents, ev: WebSocketConnectionEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
}
