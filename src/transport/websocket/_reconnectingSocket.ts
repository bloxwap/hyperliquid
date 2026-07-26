/**
 * Auto-reconnecting WebSocket: a drop-in `WebSocket` wrapper with retry
 * backoff, offline send buffering, and persistent listeners.
 *
 * In-house, clean-room replacement for the `@nktkas/rews` package, matching
 * its public API (`ReconnectingWebSocket`, `ReconnectingWebSocketOptions`,
 * `ReconnectingWebSocketError`) so the transport layer is unchanged.
 *
 * @module
 */

import { DOMException_ } from "../_polyfills.ts";

/** Specifies the type of binary data being received over a `WebSocket` connection. */
export type BinaryType = "blob" | "arraybuffer";

/** Interface mapping `WebSocket` event names to their corresponding event types. */
export interface WebSocketEventMap {
  /** Connection closed. */
  close: CloseEvent;
  /** Connection failed. */
  error: Event;
  /** Data received. */
  message: MessageEvent;
  /** Connection established. */
  open: Event;
}

/** URL or factory function that returns a URL for the WebSocket connection (sync or async). */
export type UrlProvider = string | URL | (() => string | URL | Promise<string | URL>);

/** Subprotocol(s) or factory function that returns subprotocol(s) for the WebSocket connection (sync or async). */
export type ProtocolsProvider =
  | string
  | string[]
  | undefined
  | (() => string | string[] | undefined | Promise<string | string[] | undefined>);

/** Error code indicating the type of reconnection failure. */
export type ReconnectingWebSocketErrorCode =
  | "RECONNECTION_LIMIT"
  | "RECONNECTION_DECLINED"
  | "TERMINATED_BY_USER"
  | "UNKNOWN_ERROR";

/** Configuration options for the {@linkcode ReconnectingWebSocket}. */
export interface ReconnectingWebSocketOptions {
  /**
   * Maximum number of consecutive failed reconnection attempts.
   *
   * The counter resets after a connection stays open for {@linkcode ReconnectingWebSocketOptions.stableTimeout}.
   *
   * Default: `Infinity`
   */
  maxRetries?: number;
  /**
   * Maximum number of messages buffered while disconnected; sends beyond the limit are silently dropped.
   *
   * Default: `Infinity`
   */
  maxEnqueuedMessages?: number;
  /**
   * Maximum time in ms to wait for a connection to open. Set to `null` to disable.
   *
   * Does not limit the time spent in url/protocols factories.
   *
   * Default: `10_000`
   */
  connectionTimeout?: number | null;
  /**
   * Time in ms a connection must stay open before the retry counter resets.
   *
   * Default: `3_000`
   */
  stableTimeout?: number;
  /**
   * Delay before reconnection in ms, or a function of the attempt number (0-based).
   *
   * Default: exponential backoff `2 ** attempt * 150` capped at 10s, with equal jitter.
   */
  reconnectionDelay?: number | ((attempt: number) => number);
  /**
   * Decide whether to reconnect after a non-user closure. Return `false` to permanently terminate.
   *
   * Receives the close event and the attempt number (0-based).
   * Not consulted for `close()` and `reconnect()` calls.
   *
   * Default: `() => true`
   */
  shouldReconnect?: (event: CloseEvent, attempt: number) => boolean;
}

const ERROR_MESSAGES: Record<ReconnectingWebSocketErrorCode, string> = {
  RECONNECTION_LIMIT: "Maximum reconnection attempts reached",
  RECONNECTION_DECLINED: "Reconnection declined by shouldReconnect",
  TERMINATED_BY_USER: "Connection terminated by user",
  UNKNOWN_ERROR: "Unknown error during reconnection",
};

/**
 * Error thrown when reconnection fails in {@linkcode ReconnectingWebSocket}.
 *
 * @example
 * ```ts
 * import { ReconnectingWebSocket, ReconnectingWebSocketError } from "./_reconnectingSocket.ts";
 *
 * const ws = new ReconnectingWebSocket("wss://api.example.com/ws");
 *
 * ws.terminationSignal.aborted; // boolean
 * ws.terminationSignal.reason; // ReconnectingWebSocketError, once aborted
 *
 * ws.terminationSignal.addEventListener("abort", () => {
 *   ws.terminationSignal.reason.code; // ReconnectingWebSocketErrorCode
 *   ws.terminationSignal.reason.cause; // original error, if any
 * });
 * ```
 */
export class ReconnectingWebSocketError extends Error {
  /**
   * Error code indicating the type of reconnection error:
   * - `RECONNECTION_LIMIT`: Maximum reconnection attempts reached.
   * - `RECONNECTION_DECLINED`: `shouldReconnect` returned `false`.
   * - `TERMINATED_BY_USER`: Closed via `close()` method.
   * - `UNKNOWN_ERROR`: Unhandled error outside a connection attempt (e.g. in `reconnectionDelay` or `shouldReconnect`).
   */
  readonly code: ReconnectingWebSocketErrorCode;

  /**
   * Create a termination error.
   *
   * @param code Reconnection failure code.
   * @param cause Underlying error, stored as [`Error#cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause).
   */
  constructor(code: ReconnectingWebSocketErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code], { cause });
    this.name = "ReconnectingWebSocketError";
    this.code = code;
  }
}

// Older supported runtimes lack a global `CloseEvent`; the events dispatched here only need
// the standard `CloseEvent` shape. Same pattern as the shims in `transport/_polyfills.ts`,
// kept local so the transport stays self-contained.
const CloseEvent_ = /* @__PURE__ */ (() => {
  return (
    globalThis.CloseEvent ||
    (class CloseEvent extends Event {
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;
      constructor(type: string, eventInitDict: CloseEventInit = {}) {
        super(type, eventInitDict);
        this.code = eventInitDict.code ?? 0;
        this.reason = eventInitDict.reason ?? "";
        this.wasClean = eventInitDict.wasClean ?? false;
      }
    } as typeof CloseEvent)
  );
})();

/** Upper bound of the default reconnection delay, in ms. */
const MAX_RECONNECTION_DELAY = 10_000;

/**
 * Default reconnection delay: exponential backoff `2 ** attempt * 150` capped
 * at {@linkcode MAX_RECONNECTION_DELAY}, with equal jitter — half the capped
 * delay is fixed, the other half is uniform random.
 */
function defaultReconnectionDelay(attempt: number): number {
  const capped = Math.min(2 ** attempt * 150, MAX_RECONNECTION_DELAY);
  return capped / 2 + Math.random() * (capped / 2);
}

/** Validates `close()` / `reconnect()` arguments the way the `WebSocket` spec requires. */
function assertValidCloseParams(code?: number, reason?: string): void {
  if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
    throw new DOMException_(`The close code must be 1000 or in the range 3000-4999, got ${code}.`, "SyntaxError");
  }
  if (reason !== undefined && new TextEncoder().encode(reason).length > 123) {
    throw new DOMException_("The close reason must be at most 123 UTF-8 bytes.", "SyntaxError");
  }
}

export interface ReconnectingWebSocket {
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: ReconnectingWebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: ReconnectingWebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

/**
 * Drop-in replacement for [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) that automatically reconnects.
 *
 * @example
 * ```ts
 * import { ReconnectingWebSocket } from "./_reconnectingSocket.ts";
 *
 * const ws = new ReconnectingWebSocket("wss://api.example.com/ws", {
 *   maxRetries: 10,
 *   reconnectionDelay: (attempt) => Math.min(2 ** attempt * 100, 5_000),
 * });
 *
 * ws.addEventListener("open", () => console.log("connected")); // fires on every reconnect
 * ws.addEventListener("message", (event) => console.log(event.data));
 *
 * ws.send("hello"); // buffered while offline, sent once connected
 * ```
 */
export class ReconnectingWebSocket extends EventTarget implements WebSocket {
  /** URL provider for creating new connections. */
  private readonly _urlProvider: UrlProvider;
  /** Protocols provider for creating new connections. */
  private readonly _protocolsProvider: ProtocolsProvider;
  /** Current underlying WebSocket instance; `undefined` while no attempt is in flight. */
  private _socket: WebSocket | undefined;
  /** Binary data type applied to every new underlying socket. */
  private _binaryType: BinaryType = "blob";
  /** Buffer for messages sent while disconnected. */
  private readonly _messageBuffer: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];
  /** Current reconnection attempt number. */
  private _retryCount = 0;
  /** Pending retry delay; `undefined` when not sleeping between attempts. */
  private _retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pending retry-counter reset, armed on every `open`. */
  private _stableTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pending connection timeout for the in-flight attempt. */
  private _connectionTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped per connection attempt, so a superseded in-flight factory resolution is discarded. */
  private _connectGeneration = 0;
  /** Set while a `close` event is being dispatched, so `close()` treats it as the final one. */
  private _dispatchingClose = false;
  /** URL of the current or last connection attempt; `""` before the first one resolves. */
  private _url = "";
  /** Attribute-style listeners, kept so the `on*` getters return the originally assigned handler. */
  private readonly _attributeListeners = new Map<string, { handler: EventListener; listener: EventListener }>();
  /** Controller used to signal permanent termination. */
  private readonly _abortController = new AbortController();

  /** Reconnection configuration options. Read on every attempt, so changes apply live. */
  reconnectOptions: Required<ReconnectingWebSocketOptions>;

  /**
   * AbortSignal that is aborted when the instance is permanently terminated.
   * The abort reason is always a {@linkcode ReconnectingWebSocketError}.
   */
  get terminationSignal(): AbortSignal {
    return this._abortController.signal;
  }

  /**
   * Create a new ReconnectingWebSocket with URL and options.
   *
   * @param url URL or factory function for the WebSocket connection.
   * @param options Configuration options.
   *
   * @throws {TypeError} If no WebSocket implementation is available.
   */
  constructor(url: UrlProvider, options?: ReconnectingWebSocketOptions);
  /**
   * Create a new ReconnectingWebSocket with URL, protocols and options.
   *
   * @param url URL or factory function for the WebSocket connection.
   * @param protocols Subprotocol(s) or factory function.
   * @param options Configuration options.
   *
   * @throws {TypeError} If no WebSocket implementation is available.
   */
  constructor(url: UrlProvider, protocols?: ProtocolsProvider, options?: ReconnectingWebSocketOptions);
  constructor(
    url: UrlProvider,
    protocolsOrOptions?: ProtocolsProvider | ReconnectingWebSocketOptions,
    options?: ReconnectingWebSocketOptions,
  ) {
    super();
    if (typeof globalThis.WebSocket !== "function") {
      throw new TypeError("No WebSocket implementation is available in this environment");
    }

    this._urlProvider = url;
    // Distinguish the (url, options) call from (url, protocols, options): protocols is a string,
    // a string array, a function, or undefined — an options bag is the only plain object.
    const isOptions =
      typeof protocolsOrOptions === "object" && protocolsOrOptions !== null && !Array.isArray(protocolsOrOptions);
    this._protocolsProvider = isOptions ? undefined : protocolsOrOptions;
    this.reconnectOptions = {
      maxRetries: Infinity,
      maxEnqueuedMessages: Infinity,
      connectionTimeout: 10_000,
      stableTimeout: 3_000,
      reconnectionDelay: defaultReconnectionDelay,
      shouldReconnect: (): boolean => true,
      ...(isOptions ? protocolsOrOptions : options),
    };

    void this._connect();
  }

  // ===========================================================================
  // Connection lifecycle
  // ===========================================================================

  /**
   * Runs one connection attempt: resolves the endpoint, creates the underlying
   * socket, and wires its events. A failure at any step routes through the same
   * retry policy as a closed connection.
   */
  private async _connect(): Promise<void> {
    const generation = ++this._connectGeneration;

    let url: string | URL;
    let protocols: string | string[] | undefined;
    try {
      url = typeof this._urlProvider === "function" ? await this._urlProvider() : this._urlProvider;
      protocols =
        typeof this._protocolsProvider === "function" ? await this._protocolsProvider() : this._protocolsProvider;
    } catch (error) {
      if (generation !== this._connectGeneration || this._abortController.signal.aborted) return;
      // A factory failure is a failed attempt: a synthetic 1006 close drives the retry policy.
      this._handleClosed(new CloseEvent_("close", { code: 1006 }), error);
      return;
    }

    if (generation !== this._connectGeneration || this._abortController.signal.aborted) return;

    let socket: WebSocket;
    try {
      this._url = String(url);
      socket = protocols === undefined ? new WebSocket(this._url) : new WebSocket(this._url, protocols);
      socket.binaryType = this._binaryType;
    } catch (error) {
      this._handleClosed(new CloseEvent_("close", { code: 1006 }), error);
      return;
    }

    this._socket = socket;

    socket.addEventListener("open", () => {
      if (this._socket !== socket) return;
      clearTimeout(this._connectionTimer);
      this._connectionTimer = undefined;
      // The retry counter only resets once the connection has proven stable.
      clearTimeout(this._stableTimer);
      this._stableTimer = setTimeout(() => {
        this._retryCount = 0;
      }, this.reconnectOptions.stableTimeout);
      this._flushBuffer();
      this.dispatchEvent(new Event("open"));
    });
    socket.addEventListener("message", (event) => {
      if (this._socket !== socket) return;
      // A fresh event: the incoming one is mid-dispatch on the underlying socket and
      // cannot be redispatched, and consumers only read `data`.
      this.dispatchEvent(new MessageEvent("message", { data: event.data }));
    });
    socket.addEventListener("error", () => {
      if (this._socket !== socket) return;
      this.dispatchEvent(new Event("error"));
    });
    socket.addEventListener("close", (event) => {
      if (this._socket !== socket) return;
      this._socket = undefined;
      clearTimeout(this._connectionTimer);
      this._connectionTimer = undefined;
      clearTimeout(this._stableTimer);
      this._stableTimer = undefined;
      if (this._abortController.signal.aborted) return;
      // A fresh event: the incoming one is mid-dispatch on the underlying socket
      // and cannot be redispatched.
      this._handleClosed(
        new CloseEvent_("close", { code: event.code, reason: event.reason, wasClean: event.wasClean }),
      );
    });

    // The clock starts once the socket exists; url/protocols factories are not bounded.
    const connectionTimeout = this.reconnectOptions.connectionTimeout;
    if (connectionTimeout !== null) {
      this._connectionTimer = setTimeout(() => {
        this._connectionTimer = undefined;
        if (this._socket !== socket) return;
        this._socket = undefined;
        // A stuck handshake is a failed attempt; recycle through the normal retry policy.
        try {
          socket.close();
        } catch {
          // Already closing/closed — its events are ignored either way.
        }
        this._handleClosed(new CloseEvent_("close", { code: 1006, reason: "connection timeout" }));
      }, connectionTimeout);
    }
  }

  /**
   * Handles a non-user closure: decides whether the instance retries or
   * terminates, then dispatches the `close` event — on termination the
   * signal is already aborted when the final `close` reaches listeners.
   */
  private _handleClosed(event: CloseEvent, cause?: unknown): void {
    const options = this.reconnectOptions;

    let failure: ReconnectingWebSocketError | undefined;
    let delay = 0;
    if (this._retryCount >= options.maxRetries) {
      failure = new ReconnectingWebSocketError("RECONNECTION_LIMIT", cause ?? event);
    } else {
      try {
        if (!options.shouldReconnect(event, this._retryCount)) {
          failure = new ReconnectingWebSocketError("RECONNECTION_DECLINED", event);
        } else {
          delay =
            typeof options.reconnectionDelay === "function"
              ? options.reconnectionDelay(this._retryCount)
              : options.reconnectionDelay;
        }
      } catch (error) {
        failure = new ReconnectingWebSocketError("UNKNOWN_ERROR", error);
      }
    }

    if (failure !== undefined) {
      this._terminate(failure, event);
      return;
    }

    this._retryCount++;
    this._dispatchClose(event);
    // A close listener may have terminated the instance (e.g. transport.close()).
    if (this._abortController.signal.aborted) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = undefined;
      void this._connect();
    }, delay);
  }

  /** Flushes buffered messages; a message whose `send()` throws is dropped. */
  private _flushBuffer(): void {
    const socket = this._socket;
    if (socket === undefined || socket.readyState !== ReconnectingWebSocket.OPEN) return;
    for (const message of this._messageBuffer.splice(0)) {
      try {
        // The buffer holds the wider `implements WebSocket` parameter type; TS7's lib
        // narrows `WebSocket.send` to `BufferSource`, so the forward needs the cast.
        socket.send(message as string | Blob | BufferSource);
      } catch {
        // Dropped: an unsendable message must not abort the flush of the rest.
      }
    }
  }

  /**
   * Permanently terminates the instance: aborts the termination signal, cancels
   * every pending timer, discards the send buffer, and dispatches the final
   * `close` event — unless one is already being dispatched, in which case the
   * in-flight event is the final one.
   */
  private _terminate(error: ReconnectingWebSocketError, closeEvent: CloseEvent): void {
    if (this._abortController.signal.aborted) return;
    this._abortController.abort(error);

    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    clearTimeout(this._stableTimer);
    this._stableTimer = undefined;
    clearTimeout(this._connectionTimer);
    this._connectionTimer = undefined;
    this._connectGeneration++; // discard any in-flight factory resolution
    this._socket = undefined; // a still-open socket is closed by the caller
    this._messageBuffer.length = 0;

    if (!this._dispatchingClose) this._dispatchClose(closeEvent);
  }

  /** Dispatches a `close` event, marking the dispatch so `close()` can recognize the final one. */
  private _dispatchClose(event: CloseEvent): void {
    this._dispatchingClose = true;
    try {
      this.dispatchEvent(event);
    } finally {
      this._dispatchingClose = false;
    }
  }

  // ===========================================================================
  // WebSocket API
  // ===========================================================================

  /**
   * Returns the URL that was used to establish the WebSocket connection.
   *
   * ---
   *
   * `""` before the first connection for a factory.
   */
  get url(): string {
    return this._url;
  }

  /**
   * Returns the state of the WebSocket object's connection. It can have the values described below.
   *
   * ---
   *
   * `CLOSED` only after permanent termination; any reconnection phase reports `CONNECTING`.
   */
  get readyState(): 0 | 1 | 2 | 3 {
    if (this._abortController.signal.aborted) return ReconnectingWebSocket.CLOSED;
    return (this._socket?.readyState ?? ReconnectingWebSocket.CONNECTING) as 0 | 1 | 2 | 3;
  }

  /** Number of consecutive failed reconnection attempts; resets after a connection stays open for `stableTimeout`. */
  get retryCount(): number {
    return this._retryCount;
  }

  /**
   * Returns the number of bytes of application data (UTF-8 text and binary data) that have been queued
   * using `send()` but not yet been transmitted to the network.
   */
  get bufferedAmount(): number {
    return this._socket?.bufferedAmount ?? 0;
  }

  /** Returns the extensions selected by the server, if any. */
  get extensions(): string {
    return this._socket?.extensions ?? "";
  }

  /** Returns the subprotocol selected by the server, if any. */
  get protocol(): string {
    return this._socket?.protocol ?? "";
  }

  /**
   * Returns a string that indicates how binary data from the WebSocket object is exposed to scripts.
   *
   * Can be set, to change how binary data is returned. The default is `"blob"`.
   */
  get binaryType(): BinaryType {
    return this._binaryType;
  }
  set binaryType(value: BinaryType) {
    this._binaryType = value;
    if (this._socket !== undefined) this._socket.binaryType = value;
  }

  /** Connection is being established. */
  readonly CONNECTING = 0;
  /** Connection is open and ready to communicate. */
  readonly OPEN = 1;
  /** Connection is in the process of closing. */
  readonly CLOSING = 2;
  /** Connection is closed. */
  readonly CLOSED = 3;

  /** Connection is being established. */
  static readonly CONNECTING = 0;
  /** Connection is open and ready to communicate. */
  static readonly OPEN = 1;
  /** Connection is in the process of closing. */
  static readonly CLOSING = 2;
  /** Connection is closed. */
  static readonly CLOSED = 3;

  /** Attribute-style handler for `close` events. */
  get onclose(): ((this: WebSocket, ev: CloseEvent) => any) | null {
    return (this._attributeListeners.get("close")?.handler ?? null) as
      | ((this: WebSocket, ev: CloseEvent) => any)
      | null;
  }
  /** Set the attribute-style handler for `close` events. */
  set onclose(handler: ((this: WebSocket, ev: CloseEvent) => any) | null) {
    this._setAttributeListener("close", handler);
  }
  /** Attribute-style handler for `error` events. */
  get onerror(): ((this: WebSocket, ev: Event) => any) | null {
    return (this._attributeListeners.get("error")?.handler ?? null) as ((this: WebSocket, ev: Event) => any) | null;
  }
  /** Set the attribute-style handler for `error` events. */
  set onerror(handler: ((this: WebSocket, ev: Event) => any) | null) {
    this._setAttributeListener("error", handler);
  }
  /** Attribute-style handler for `message` events. */
  get onmessage(): ((this: WebSocket, ev: MessageEvent) => any) | null {
    return (this._attributeListeners.get("message")?.handler ?? null) as
      | ((this: WebSocket, ev: MessageEvent) => any)
      | null;
  }
  /** Set the attribute-style handler for `message` events. */
  set onmessage(handler: ((this: WebSocket, ev: MessageEvent) => any) | null) {
    this._setAttributeListener("message", handler);
  }
  /** Attribute-style handler for `open` events. */
  get onopen(): ((this: WebSocket, ev: Event) => any) | null {
    return (this._attributeListeners.get("open")?.handler ?? null) as ((this: WebSocket, ev: Event) => any) | null;
  }
  /** Set the attribute-style handler for `open` events. */
  set onopen(handler: ((this: WebSocket, ev: Event) => any) | null) {
    this._setAttributeListener("open", handler);
  }

  /** Attaches or detaches the dispatcher for an attribute-style event handler. */
  private _setAttributeListener(type: string, handler: ((event: any) => any) | null): void {
    const existing = this._attributeListeners.get(type);
    if (existing !== undefined) {
      this.removeEventListener(type, existing.listener);
      this._attributeListeners.delete(type);
    }
    if (handler !== null) {
      // A wrapper keeps the registered listener distinct from the assigned handler, so
      // assigning the same function to two `on*` attributes never deduplicates it away.
      const listener = (event: Event): void => handler.call(this, event);
      this._attributeListeners.set(type, { handler, listener });
      this.addEventListener(type, listener);
    }
  }

  /**
   * Permanently terminates the connection, optionally using `code` as the WebSocket connection
   * close code and `reason` as the WebSocket connection close reason.
   *
   * Synchronous: when it returns, the termination signal is already aborted and the final
   * `close` event has been dispatched (a `close` event already being dispatched counts as final).
   *
   * @param code Status code for the closure.
   * @param reason Human-readable reason for the closure.
   *
   * @throws {DOMException} If the code is not 1000 or in 3000-4999, or the reason is longer than 123 UTF-8 bytes.
   */
  close(code?: number, reason?: string): void {
    assertValidCloseParams(code, reason);
    if (this._abortController.signal.aborted) return;

    const socket = this._socket;
    if (socket !== undefined) {
      this._socket = undefined; // its events are ignored from here on
      try {
        socket.close(code, reason);
      } catch {
        // Already closing/closed.
      }
    }

    this._terminate(
      new ReconnectingWebSocketError("TERMINATED_BY_USER"),
      new CloseEvent_("close", { code: code ?? 1000, reason: reason ?? "", wasClean: true }),
    );
  }

  /**
   * Drops the current connection and reconnects immediately.
   *
   * - The closed socket does not count towards `maxRetries`.
   * - The current retry delay, if any, is skipped.
   * - Cannot interrupt an in-flight url/protocols factory.
   * - Does nothing once permanently terminated.
   *
   * @param code Status code for closing the current socket.
   * @param reason Human-readable reason for the closure.
   *
   * @throws {DOMException} If the code is not 1000 or in 3000-4999, or the reason is longer than 123 UTF-8 bytes.
   */
  reconnect(code?: number, reason?: string): void {
    assertValidCloseParams(code, reason);
    if (this._abortController.signal.aborted) return;

    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;

    const socket = this._socket;
    if (socket !== undefined) {
      this._socket = undefined; // its events are ignored from here on
      clearTimeout(this._connectionTimer);
      this._connectionTimer = undefined;
      clearTimeout(this._stableTimer);
      this._stableTimer = undefined;
      // Consumers observe the drop exactly like a server close, except it never counts as a retry.
      this._dispatchClose(new CloseEvent_("close", { code: code ?? 1000, reason: reason ?? "", wasClean: true }));
      if (this._abortController.signal.aborted) return; // a close listener terminated the instance
      try {
        socket.close(code, reason);
      } catch {
        // Already closing/closed.
      }
    }

    void this._connect();
  }

  /**
   * Transmits data using the WebSocket connection. `data` can be a string, a Blob, an ArrayBuffer, or an ArrayBufferView.
   *
   * If the connection is not open, the data is buffered (up to `maxEnqueuedMessages`)
   * and sent once it is established. After permanent termination, data is silently discarded.
   *
   * @param data Payload to transmit or buffer.
   */
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this._abortController.signal.aborted) return;

    const socket = this._socket;
    if (socket !== undefined && socket.readyState === ReconnectingWebSocket.OPEN) {
      // See `_flushBuffer`: the wider parameter type needs a cast for TS7's narrower `send`.
      socket.send(data as string | Blob | BufferSource);
      return;
    }

    if (this._messageBuffer.length >= this.reconnectOptions.maxEnqueuedMessages) return;
    this._messageBuffer.push(data);
  }
}
