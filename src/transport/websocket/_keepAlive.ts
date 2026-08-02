/**
 * Keep-alive watchdog for the WebSocket connection: pings the server on an
 * interval and reconnects when a ping stays unanswered.
 *
 * @module
 */

import type { ReconnectingWebSocket } from "./_reconnectingSocket.ts";
import type { HyperliquidEventTarget } from "./_events.ts";
import type { WebSocketQuota } from "./_quota.ts";

/** Configuration options for the keep-alive watchdog. */
export interface WebSocketKeepAliveOptions {
  /**
   * Interval between pings in ms.
   *
   * The server closes a connection that has been silent for ~60 s, so pings must come more often than that.
   *
   * Default: `5_000`
   */
  interval?: number;
  /**
   * Time to wait for a pong before forcing a reconnect, in ms.
   *
   * Default: `3_000`
   */
  timeout?: number;
}

/** Pings the server while the connection is open and reconnects when a ping stays unanswered. */
export class WebSocketKeepAlive {
  private readonly _socket: ReconnectingWebSocket;
  private readonly _interval: number;
  private readonly _timeout: number;
  /**
   * The per-IP outbound message budget pings are billed to, or `undefined` when unbudgeted.
   *
   * Pings are not free: at the 5 s default each open socket spends 12 of the 2000 messages
   * a minute allows, and that budget is shared by every connection from this host. They are
   * charged rather than paced — delaying the watchdog is how a half-open socket goes
   * unnoticed — so heavy ping traffic slows subscribes instead of itself.
   */
  private readonly _quota: WebSocketQuota | undefined;
  private _pingInterval: ReturnType<typeof setInterval> | undefined;
  private _pongTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    socket: ReconnectingWebSocket,
    hlEvents: HyperliquidEventTarget,
    options?: WebSocketKeepAliveOptions,
    quota?: WebSocketQuota,
  ) {
    this._socket = socket;
    this._interval = options?.interval ?? 5_000;
    this._timeout = options?.timeout ?? 3_000;
    this._quota = quota;

    hlEvents.addEventListener("pong", () => this._disarm());
    socket.addEventListener("open", () => this._start());
    socket.addEventListener("close", () => this._stop());
    socket.addEventListener("error", () => this._stop());
  }

  private _start(): void {
    if (this._pingInterval) return;
    this._pingInterval = setInterval(() => {
      this._socket.send('{"method":"ping"}');
      this._quota?.chargeSend();
      // A half-open connection never answers: reconnect once a ping stays unanswered.
      this._pongTimeout ??= setTimeout(() => this._socket.reconnect(), this._timeout);
    }, this._interval);
  }

  private _stop(): void {
    clearInterval(this._pingInterval);
    this._pingInterval = undefined;
    this._disarm();
  }

  private _disarm(): void {
    clearTimeout(this._pongTimeout);
    this._pongTimeout = undefined;
  }
}
