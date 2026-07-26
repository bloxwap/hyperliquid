/**
 * WebSocket request dispatcher: sends `post`, `subscribe`, and `unsubscribe`
 * messages and matches responses by id.
 *
 * @module
 */

import { ReconnectingWebSocket } from "./_reconnectingSocket.ts";
import * as abort from "../_abort.ts";
import { TransportError } from "../_base.ts";
import { Promise_ } from "../_polyfills.ts";
import type { HyperliquidEventTarget, PostResponse, SubscribeUnsubscribeResponse } from "./_events.ts";
import { isSubset, normalize, requestToId, specificity } from "./_id.ts";

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown when a WebSocket request fails.
 *
 * @example
 * ```ts
 * import { WebSocketRequestError, WebSocketTransport } from "@bloxwap/hyperliquid";
 *
 * const transport = new WebSocketTransport();
 * try {
 *   // Throws on a server rejection, a timeout, an abort, or a lost connection.
 *   await transport.request("info", { type: "allMids" });
 * } catch (error) {
 *   if (error instanceof WebSocketRequestError) {
 *     console.error(error.message, error.request);
 *   }
 * }
 * ```
 */
export class WebSocketRequestError extends TransportError {
  /** The original request payload that triggered the error, if available. */
  request?: unknown;

  /**
   * Creates a WebSocket request error.
   *
   * The failed request payload goes into `options.request`.
   */
  constructor(message?: string, options?: ErrorOptions & { request?: unknown }) {
    super(message, options);
    this.name = "WebSocketRequestError";
    this.request = options?.request;
  }
}

// =============================================================================
// Internal types
// =============================================================================

/**
 * Outgoing `post` envelope.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/post-requests
 */
interface PostRequest {
  method: "post";
  id: number;
  request: unknown;
}

/**
 * Outgoing `subscribe` / `unsubscribe` envelope.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
 */
interface SubscribeUnsubscribeRequest {
  method: "subscribe" | "unsubscribe";
  subscription: unknown;
}

/** A queued request awaiting its response. */
interface PendingRequest {
  id: number | string;
  payload: unknown;
  /** The wire frame, kept until the connection can actually carry it. */
  frame: string;
  sent: boolean;
  /**
   * Echo-matching data for a `subscribe` / `unsubscribe` request: the normalized request
   * envelope (the object form of the entry's string id) and its specificity, derived when the
   * entry is created. Absent for `post` requests, which match on their numeric id.
   *
   * Every `subscriptionResponse` frame that misses the exact-id bucket walks the whole queue
   * looking for its match, so deriving this per scan made a burst of N re-subscriptions cost
   * N² parses — a reconnect at the 1000-subscription cap stalled the event loop exactly when
   * the book was most stale.
   */
  echo?: {
    /** The normalized request envelope compared against the echo. */
    request: unknown;
    /** {@linkcode specificity} of `request`, the tie-breaker between several subset matches. */
    specificity: number;
  };
  // deno-lint-ignore no-explicit-any
  resolve: (value?: any) => void;
  // deno-lint-ignore no-explicit-any
  reject: (reason?: any) => void;
}

// =============================================================================
// Dispatcher
// =============================================================================

/**
 * Owns the WebSocket request queue and matches server responses back to
 * in-flight requests.
 */
export class WebSocketDispatcher {
  /** Timeout for requests in ms. Set to `null` to disable. */
  timeout: number | null;

  private readonly _socket: ReconnectingWebSocket;
  private _lastId = 0;
  /**
   * Every in-flight request, in the order it was queued — a `Set` so removing a settled entry
   * costs no scan and no memmove, while the iteration order the `open` flush relies on is the
   * insertion order an array gave.
   */
  private readonly _queue: Set<PendingRequest> = new Set();
  /** Index of {@linkcode _queue} by numeric `post` id, so a post response matches in O(1). */
  private readonly _posts: Map<number, PendingRequest> = new Map();
  /**
   * Index of {@linkcode _queue} by string subscription id, in enqueue order per bucket. A
   * verbatim server echo normalizes to exactly that id, so the common case matches with one
   * map lookup instead of an O(queue) subset scan per frame — the scan made a burst of N
   * re-subscription echoes cost N² subset checks.
   */
  private readonly _byEchoId: Map<string, PendingRequest[]> = new Map();

  constructor(socket: ReconnectingWebSocket, hlEvents: HyperliquidEventTarget, timeout: number | null) {
    this.timeout = timeout;
    this._socket = socket;

    // --- Hyperliquid event handlers ------------------------------------------
    hlEvents.addEventListener("subscriptionResponse", (event) => this._handleSubscriptionResponse(event.detail));
    hlEvents.addEventListener("post", (event) => this._handlePostResponse(event.detail));
    hlEvents.addEventListener("error", (event) => this._handleErrorEvent(event.detail));

    // --- Socket lifecycle ----------------------------------------------------
    // A rejected unsent request is guaranteed to never reach the server.
    const handleDisconnect = (): void => {
      // Snapshot and empty the queue before rejecting, so nothing observes it half-cleared and
      // the abort/`finally` dequeues these rejections trigger find nothing left to do.
      const abandoned = [...this._queue];
      this._queue.clear();
      this._posts.clear();
      this._byEchoId.clear();
      for (const { sent, payload, reject } of abandoned) {
        reject(
          new WebSocketRequestError(
            sent ? "WebSocket connection closed" : "WebSocket connection closed before the request was sent",
            { request: payload },
          ),
        );
      }
    };
    socket.addEventListener("close", handleDisconnect);
    socket.addEventListener("error", handleDisconnect);
    socket.addEventListener("open", () => {
      // Everything still queued at this point was held back while disconnected.
      for (const entry of this._queue) {
        entry.sent = true;
        this._socket.send(entry.frame);
      }
    });
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Sends a request and resolves with the matched server response.
   *
   * @param signal Cancels the request from the caller's side.
   */
  async request<T>(method: "post" | "subscribe" | "unsubscribe", payload: unknown, signal?: AbortSignal): Promise<T> {
    // One controller per request: the timeout timer, the user signal, and the
    // socket termination relay into it, and `finally` detaches everything, so
    // no listener or timer outlives the request.
    const controller = new AbortController();
    const timeoutMs = this.timeout; // for correct error message after user changes
    const timeout = abort.scheduleTimeout(controller, timeoutMs);
    const detachRelay = abort.relay([signal, this._socket.terminationSignal], controller);

    let entry: PendingRequest | undefined;
    try {
      if (controller.signal.aborted) throw controller.signal.reason;

      // --- Build request envelope --------------------------------------------
      const request: SubscribeUnsubscribeRequest | PostRequest =
        method === "post" ? { method, id: ++this._lastId, request: payload } : { method, subscription: payload };

      // A subscription id is the normalized envelope; keep the normalized object alongside it,
      // since echo matching consumes it as an object and re-parsing the id would just undo the
      // stringify. The wire frame below still stringifies the envelope as built.
      let id: number | string;
      let echo: PendingRequest["echo"];
      if ("id" in request) {
        id = request.id;
      } else {
        const normalized = normalize(request);
        id = JSON.stringify(normalized);
        echo = { request: normalized, specificity: specificity(normalized) };
      }

      // --- Send or queue -----------------------------------------------------
      const frame = JSON.stringify(request);
      const sent = this._socket.readyState === ReconnectingWebSocket.OPEN;
      if (sent) this._socket.send(frame);

      const { promise, resolve, reject } = Promise_.withResolvers<T>();
      const pending = (entry = { id, payload, frame, sent, echo, resolve, reject });
      this._enqueue(pending);

      controller.signal.addEventListener(
        "abort",
        () => {
          // Dequeue synchronously: an `open` flush between the abort and the
          // `finally` microtask must not send a frame the caller saw rejected.
          this._dequeue(pending);
          reject(controller.signal.reason);
        },
        { once: true },
      );

      return await promise;
    } catch (error) {
      if (error instanceof TransportError) throw error;
      if (error === timeout.reason) {
        throw new WebSocketRequestError(`Request timed out after ${timeoutMs} ms`, {
          cause: error,
          request: payload,
        });
      }
      if (this._socket.terminationSignal.aborted && error === this._socket.terminationSignal.reason) {
        throw new WebSocketRequestError("WebSocket connection permanently terminated", {
          cause: error,
          request: payload,
        });
      }
      if (controller.signal.aborted && error === controller.signal.reason) {
        throw new WebSocketRequestError("Request aborted", { cause: error, request: payload });
      }
      throw new WebSocketRequestError(`Unknown error while making a WebSocket request: ${error}`, {
        cause: error,
        request: payload,
      });
    } finally {
      if (entry) this._dequeue(entry);
      timeout.cancel();
      detachRelay();
    }
  }

  // ===========================================================================
  // Queue
  // ===========================================================================

  /** Queues a request and indexes it by id. */
  private _enqueue(entry: PendingRequest): void {
    this._queue.add(entry);
    if (typeof entry.id === "number") this._posts.set(entry.id, entry);
    if (typeof entry.id === "string") {
      const bucket = this._byEchoId.get(entry.id);
      if (bucket) bucket.push(entry);
      else this._byEchoId.set(entry.id, [entry]);
    }
  }

  /** Removes a request from the queue and from the id indexes. Idempotent. */
  private _dequeue(entry: PendingRequest): void {
    if (!this._queue.delete(entry)) return;
    // Post ids are handed out by `++this._lastId`, so no later entry can hold this one.
    if (typeof entry.id === "number") this._posts.delete(entry.id);
    if (typeof entry.id === "string") {
      const bucket = this._byEchoId.get(entry.id);
      if (bucket) {
        const index = bucket.indexOf(entry);
        if (index !== -1) bucket.splice(index, 1);
        if (bucket.length === 0) this._byEchoId.delete(entry.id);
      }
    }
  }

  // ===========================================================================
  // Event handlers
  // ===========================================================================

  private _handleSubscriptionResponse(detail: SubscribeUnsubscribeResponse): void {
    this._findByEcho(detail)?.resolve(detail);
  }

  private _handlePostResponse(detail: PostResponse): void {
    const pending = this._posts.get(detail.id);
    if (!pending) return;

    if (detail.response.type === "error") {
      pending.reject(new WebSocketRequestError(detail.response.payload, { request: pending.payload }));
    } else {
      const data = detail.response.type === "info" ? detail.response.payload.data : detail.response.payload;
      pending.resolve(data);
    }
  }

  private _handleErrorEvent(detail: string): void {
    // Reject by the trailing id, e.g. `too many pending post requests id=1234`.
    const idMatch = detail.match(/id=(\d+)$/);
    if (idMatch) {
      this._reject(this._posts.get(parseInt(idMatch[1], 10)), detail);
      return;
    }

    // The remaining heuristics match by the request echoed in the message body; an embedded
    // `{…}` body is valid JSON by the server contract, but a malformed one must not throw out
    // of the event listener — it simply matches nothing, like a body-less message.
    const requestMatch = detail.match(/{.*}/)?.[0];
    if (!requestMatch) return;
    let parsedRequest: Record<string, unknown>;
    try {
      parsedRequest = JSON.parse(requestMatch) as Record<string, unknown>;
    } catch {
      return;
    }

    // A `post` envelope echo carries a numeric id.
    if (typeof parsedRequest.id === "number") {
      this._reject(this._posts.get(parsedRequest.id), detail);
      return;
    }

    // A `subscribe` / `unsubscribe` envelope echo carries the subscription.
    if (typeof parsedRequest.subscription === "object" && parsedRequest.subscription !== null) {
      this._reject(this._findByEcho(parsedRequest), detail);
      return;
    }

    // These prefixes echo only the subscription payload, without an envelope.
    if (detail.startsWith("Already subscribed") || detail.startsWith("Invalid subscription")) {
      this._reject(this._findByEcho({ method: "subscribe", subscription: parsedRequest }), detail);
      return;
    }
    if (detail.startsWith("Already unsubscribed")) {
      this._reject(this._findByEcho({ method: "unsubscribe", subscription: parsedRequest }), detail);
    }
  }

  /** Rejects `pending`, when found, with the server text as the message. */
  private _reject(pending: PendingRequest | undefined, detail: string): void {
    pending?.reject(new WebSocketRequestError(detail, { request: pending.payload }));
  }

  /**
   * Finds the pending request matching an echoed body.
   *
   * The server usually echoes the request verbatim, so the echo's normalized form is
   * byte-identical to the pending entry's id and a bucket lookup answers in O(1). The server
   * can also normalize the echo — fields can be added to the payload and unknown ones dropped —
   * in which case the bucket misses and the queue is searched by subset. Among several subset
   * matches the most specific pending wins: when one in-flight payload is a subset of another,
   * the looser one must not swallow the echo meant for the stricter one.
   */
  private _findByEcho(echo: unknown): PendingRequest | undefined {
    // Bucket order is enqueue order and every entry in a bucket shares one normalized request,
    // hence one specificity — so the first match here is exactly what the scan below would pick
    // (a same-specificity tie goes to the earliest enqueued). The subset check is a formality:
    // an id collision implies equal normalized forms, which always subset-match.
    const bucket = this._byEchoId.get(requestToId(echo));
    if (bucket) {
      for (const pending of bucket) {
        if (pending.echo !== undefined && isSubset(pending.echo.request, echo)) return pending;
      }
    }

    let best: PendingRequest | undefined;
    let bestSpecificity = -1;
    for (const pending of this._queue) {
      // Only subscription requests match by echo, and those are exactly the entries carrying it.
      if (pending.echo === undefined) continue;
      if (!isSubset(pending.echo.request, echo)) continue;
      if (pending.echo.specificity > bestSpecificity) {
        best = pending;
        bestSpecificity = pending.echo.specificity;
      }
    }
    return best;
  }
}
