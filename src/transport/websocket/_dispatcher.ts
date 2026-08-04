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
import { redactSignature, UNSERIALIZABLE_REQUEST } from "../_redact.ts";
import type { HyperliquidEventTarget, PostResponse, SubscribeUnsubscribeResponse } from "./_events.ts";
import { isSubset, normalize, requestToId, specificity } from "./_id.ts";
import type { WebSocketQuota } from "./_quota.ts";

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
  /**
   * The request payload as it went over the wire, if available: a snapshot of the exact
   * serialization the transport sent, with every `signature`/`signatures` value replaced by
   * `"0x<redacted>"` — at any depth, including the `{ type, payload }` envelope this transport
   * wraps exchange requests in and multi-sig `action.signatures` — so logging or forwarding the
   * error cannot leak them. It is always a plain-data copy, never the live object; when the
   * payload could not be serialized at all, it is the constant `"[unserializable request]"`.
   */
  request?: unknown;

  /**
   * Creates a WebSocket request error.
   *
   * The failed request payload goes into `options.request`.
   */
  constructor(message?: string, options?: ErrorOptions & { request?: unknown }) {
    super(message, options);
    this.name = "WebSocketRequestError";
    this.request = redactSignature(options?.request);
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

/**
 * Internal-only precomputation a trusted caller can hand to {@linkcode WebSocketDispatcher.request}.
 * The dispatcher class is not re-exported from the package entry point, so this hint never
 * reaches the public API surface.
 */
export interface RequestHint {
  /**
   * The caller's precomputed `requestToId(payload)` for a `subscribe` / `unsubscribe` request.
   * Valid only when `payload` is already in normalized form (the subscription manager's
   * snapshot): the dispatcher then skips its own normalize of the subscription subtree and
   * builds the envelope id by concatenation. Ignored for `post` requests.
   */
  subscriptionId: string;
}

/** A queued request awaiting its response. */
interface PendingRequest {
  id: number | string;
  /**
   * The wire frame, kept until the connection can actually carry it. It is also the snapshot
   * source for the `request` field of any error this entry produces — the live payload is never
   * stored, so errors never traverse it.
   */
  frame: string;
  sent: boolean;
  /**
   * Echo-matching data for a `subscribe` / `unsubscribe` request: the normalized request
   * envelope (the object form of the entry's string id) and its specificity. Absent for `post`
   * requests, which match on their numeric id.
   *
   * Every `subscriptionResponse` frame that misses the exact-id bucket walks the whole queue
   * looking for its match, so deriving this per scan made a burst of N re-subscriptions cost
   * N² parses — a reconnect at the 1000-subscription cap stalled the event loop exactly when
   * the book was most stale.
   */
  echo?: {
    /** The normalized request envelope compared against the echo. */
    request: unknown;
    /**
     * {@linkcode specificity} of `request`, the tie-breaker between several subset matches.
     * Only the `_findByEcho` fallback scan consumes it — a rare path, taken solely when the
     * server rewrote the echo — so it is computed lazily on first access (see {@linkcode echoData}).
     */
    readonly specificity: number;
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
  /** Shared request-timeout scheduler: at most one armed native timer, however many requests are in flight. */
  private readonly _timeouts: abort.TimeoutWheel;
  /**
   * Controllers to abort when the socket terminates permanently: every in-flight request that
   * was not already settled by its own signal.
   *
   * The socket's `terminationSignal` is ONE `AbortSignal` shared by every request. Relaying it
   * per request — `abort.relay([signal, terminationSignal], controller)` — put one listener per
   * in-flight request on that single signal, and `AbortSignal` is an `EventTarget` whose
   * per-type listener list is scanned linearly by both `addEventListener` and
   * `removeEventListener`. Each request's attach/detach pair was therefore O(in-flight), making
   * a burst O(n^2): measured at 195 ns per pair with the list empty and 13.1 µs with 5000
   * listeners resident on Bun (40.4 µs on Node). A reconnect at the 1000-subscription cap —
   * exactly the storm the {@linkcode PendingRequest.echo} comment describes — paid it worst.
   *
   * One listener on the signal plus a `Set` of controllers makes attach and detach O(1), and
   * costs ~300 ns less per request even at an in-flight count of one.
   */
  private readonly _terminating: Set<AbortController> = new Set();
  /**
   * The per-IP outbound message budget, or `undefined` when this dispatcher is not budgeted.
   *
   * Hyperliquid caps messages sent at 2000/minute per IP across every connection, and
   * without pacing the SDK overruns it in one burst: at the 1000-subscription cap a single
   * reconnect re-subscribes everything at once, spending half the minute's budget instantly,
   * and a socket flapping under `maxRetries: Infinity` repeats that — which is why the
   * shared default quota paces outbound messages (see `sharedWebSocketQuota` in `_quota.ts`).
   */
  private readonly _quota: WebSocketQuota | undefined;

  constructor(
    socket: ReconnectingWebSocket,
    hlEvents: HyperliquidEventTarget,
    timeout: number | null,
    quota?: WebSocketQuota,
  ) {
    this.timeout = timeout;
    this._socket = socket;
    this._timeouts = new abort.TimeoutWheel();
    this._quota = quota;

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
      for (const entry of abandoned) {
        entry.reject(
          new WebSocketRequestError(
            entry.sent ? "WebSocket connection closed" : "WebSocket connection closed before the request was sent",
            { request: payloadSnapshot(entry.frame, typeof entry.id === "number") },
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
        // Only `post` entries (numeric id) debit the message budget here: their frame is
        // reaching the socket for the first time and the send-immediately charge in
        // `request` never ran. Subscription entries already paid a token in `acquireSend`
        // at request() time; charging them again would double-count every flushed frame.
        // See the send-immediately branch in `request` for the full charging story.
        if (typeof entry.id === "number") this._quota?.chargeSend();
      }
    });

    // --- Termination fan-out -------------------------------------------------
    // ONE listener on the socket's shared termination signal for this dispatcher's whole life,
    // fanning out to the in-flight requests. See {@linkcode _terminating} for why a per-request
    // listener here was quadratic.
    socket.terminationSignal.addEventListener(
      "abort",
      () => {
        const reason = socket.terminationSignal.reason;
        // Snapshot before aborting: each `abort` runs its request's `finally`, which deletes
        // from this set while it is being iterated.
        const pending = [...this._terminating];
        this._terminating.clear();
        for (const controller of pending) controller.abort(reason);
      },
      { once: true },
    );
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Sends a request and resolves with the matched server response.
   *
   * @param signal Cancels the request from the caller's side.
   * @param hint Internal-only precomputed ids; see {@linkcode RequestHint}.
   */
  async request<T>(
    method: "post" | "subscribe" | "unsubscribe",
    payload: unknown,
    signal?: AbortSignal,
    hint?: RequestHint,
  ): Promise<T> {
    // --- Outbound budget ------------------------------------------------------
    // Paced before the timeout is armed, so deliberate throttling never trips the request
    // timeout — the same ordering `HttpTransport` uses.
    //
    // `post` is deliberately excluded: `_shell.ts` fixes the wire order of an exchange
    // action on `transport.request` reaching `send` synchronously, so awaiting here would
    // let a later nonce overtake an earlier one. Posts debit the budget without waiting —
    // when their frame reaches the socket, in the send-immediately branch below or in the
    // `open` flush — which still slows subscription traffic when orders are heavy but can
    // never delay or reorder an order. `acquireSend` returns `undefined` rather than a
    // resolved promise when nothing needs waiting on, keeping this function synchronous to
    // `send` for every request that is not actually being throttled.
    if (method !== "post" && this._quota !== undefined) {
      // The wait must not outlive the connection: the socket's termination signal abandons
      // the wait when the transport closes for good. Otherwise each paced waiter of a
      // closed transport would still consume a token for a frame that can never send — and
      // hold its FIFO slot ahead of live transports sharing the quota. A caller signal
      // composes with it via `AbortSignal.any`, with the caller's reason winning when both
      // are already aborted — the same precedence the controller relay below reproduces.
      // No in-repo paced caller passes a signal today (the subscription manager never
      // does), so the common path allocates no composite.
      const pacingSignal =
        signal === undefined
          ? this._socket.terminationSignal
          : AbortSignal.any([signal, this._socket.terminationSignal]);
      const paced = this._quota.acquireSend(pacingSignal);
      if (paced !== undefined) {
        try {
          await paced;
        } catch (error) {
          // Wrapped here because this await runs before the main try — whose catch would
          // never see this rejection — and the dispatcher's contract is to reject only
          // with WebSocketRequestError. `payload` is safe to attach: only the subscription
          // manager reaches this path, and it always hands over its own plain-data snapshot.
          const terminated = this._socket.terminationSignal.aborted && error === this._socket.terminationSignal.reason;
          throw new WebSocketRequestError(
            terminated ? "WebSocket connection permanently terminated" : "Request aborted",
            { cause: error, request: payload },
          );
        }
      }
    }

    // One controller per request: the timeout timer, the user signal, and the
    // socket termination relay into it, and `finally` detaches everything, so
    // no listener or timer outlives the request.
    const controller = new AbortController();
    const timeoutMs = this.timeout; // for correct error message after user changes
    const timeout = this._timeouts.schedule(controller, timeoutMs);
    // The caller's signal is relayed first, and the termination branch below runs only while the
    // controller is still unaborted. Together those reproduce `relay([signal, terminationSignal])`
    // exactly, INCLUDING its reason precedence: `relay` aborts with the first already-aborted
    // source in argument order, so when the caller's signal and the socket's termination are both
    // aborted before the request starts, the caller's reason is the one that surfaces. Reversing
    // these two lines silently changes the error a caller sees in that case.
    const detachRelay = abort.relay([signal], controller);
    if (!controller.signal.aborted) {
      // A shared listener with an O(1) Set membership, rather than a listener per request on a
      // signal every request shares — see {@linkcode _terminating}.
      if (this._socket.terminationSignal.aborted) controller.abort(this._socket.terminationSignal.reason);
      else this._terminating.add(controller);
    }

    let entry: PendingRequest | undefined;
    // The one serialization of the request envelope — wire form and error snapshot source.
    let frame: string | undefined;
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
      } else if (hint?.subscriptionId !== undefined) {
        // The subscription manager hands over the id it already computed; per the hint contract
        // `payload` is its normalized snapshot, so the normalized envelope is one shallow object
        // and its id plain concatenation — no re-normalize of the subscription subtree.
        id = `{"method":"${request.method}","subscription":${hint.subscriptionId}}`;
        echo = echoData({ method: request.method, subscription: payload });
        // That concatenation is character-for-character what `JSON.stringify(request)` produces:
        // the envelope is `{method, subscription}` in that order and the hint's id is the
        // stringified snapshot `payload` points at. Reusing it skips a second serialization of the
        // whole subscription subtree on every subscribe, unsubscribe and reconnect resubscribe.
        frame = id;
      } else {
        const normalized = normalize(request);
        id = JSON.stringify(normalized);
        echo = echoData(normalized);
      }

      // --- Send or queue -----------------------------------------------------
      frame ??= JSON.stringify(request);
      const sent = this._socket.readyState === ReconnectingWebSocket.OPEN;
      if (sent) {
        this._socket.send(frame);
        // The charging story, stated once: every frame debits the message budget exactly
        // one time. `subscribe`/`unsubscribe` paid a token in `acquireSend` above, whether
        // the frame goes out here or from the `open` flush. A `post` never waited there, so
        // it debits when its frame reaches the socket — here when connected, in the `open`
        // flush when queued while disconnected. Post debits can drive the bucket into debt
        // when orders outpace the refill, which later `subscribe` frames wait off.
        if (method === "post") this._quota?.chargeSend();
      }

      const { promise, resolve, reject } = Promise_.withResolvers<T>();
      const pending = (entry = { id, frame, sent, echo, resolve, reject });
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
          request: payloadSnapshot(frame, method === "post"),
        });
      }
      if (this._socket.terminationSignal.aborted && error === this._socket.terminationSignal.reason) {
        throw new WebSocketRequestError("WebSocket connection permanently terminated", {
          cause: error,
          request: payloadSnapshot(frame, method === "post"),
        });
      }
      if (controller.signal.aborted && error === controller.signal.reason) {
        throw new WebSocketRequestError("Request aborted", {
          cause: error,
          request: payloadSnapshot(frame, method === "post"),
        });
      }
      throw new WebSocketRequestError(`Unknown error while making a WebSocket request: ${error}`, {
        cause: error,
        request: payloadSnapshot(frame, method === "post"),
      });
    } finally {
      if (entry) this._dequeue(entry);
      timeout.cancel();
      detachRelay();
      // O(1) — this is the detach that used to scan the shared signal's listener list.
      this._terminating.delete(controller);
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

    // The response frame is a trusted contract, but a frame that breaks it must reject the
    // request with a descriptive error — never resolve `undefined` (upstream nktkas#50: an
    // `undefined` resolution surfaced as a TypeError deep in the exchange client) and never
    // throw out of this listener (the guarded dispatch would swallow the throw and the
    // request would hang until the timeout).
    const response = detail.response as { type?: unknown; payload?: unknown } | null | undefined;
    const malformed = (): WebSocketRequestError =>
      new WebSocketRequestError(`Malformed post response: ${JSON.stringify(detail)}`, {
        request: payloadSnapshot(pending.frame, typeof pending.id === "number"),
      });

    if (typeof response !== "object" || response === null || typeof response.type !== "string") {
      pending.reject(malformed());
      return;
    }

    if (response.type === "error") {
      const message = typeof response.payload === "string" ? response.payload : malformed().message;
      pending.reject(
        new WebSocketRequestError(message, { request: payloadSnapshot(pending.frame, typeof pending.id === "number") }),
      );
      return;
    }
    if (response.type === "info") {
      const payload = response.payload as { data?: unknown } | null | undefined;
      if (typeof payload === "object" && payload !== null && payload.data !== undefined) {
        pending.resolve(payload.data);
      } else {
        pending.reject(malformed());
      }
      return;
    }
    if (response.type === "action") {
      // The payload resolved with is itself an envelope ({status, response}): validate the
      // nested level too, so a payload without a usable inner response cannot hand
      // `undefined` to the exchange client one level deeper (same nktkas#50 class).
      const payload = response.payload as { status?: unknown; response?: unknown } | null | undefined;
      const inner = typeof payload === "object" && payload !== null ? payload.response : undefined;
      const innerUsable =
        typeof inner === "string" ||
        (typeof inner === "object" && inner !== null && typeof (inner as { type?: unknown }).type === "string");
      if (
        typeof payload === "object" &&
        payload !== null &&
        (payload.status === "ok" || payload.status === "err") &&
        innerUsable
      ) {
        pending.resolve(payload);
      } else {
        pending.reject(malformed());
      }
      return;
    }
    pending.reject(
      new WebSocketRequestError(`Unknown post response type "${response.type}"`, {
        request: payloadSnapshot(pending.frame, typeof pending.id === "number"),
      }),
    );
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
    pending?.reject(
      new WebSocketRequestError(detail, { request: payloadSnapshot(pending.frame, typeof pending.id === "number") }),
    );
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
    //
    // Fast path: a verbatim echo of a normalized request reserializes to exactly the pending
    // entry's id, so one plain stringify answers the bucket lookup and the normalize walk in
    // `requestToId` is skipped. A bucket key is itself a normalized id, so a verbatim hit can
    // only occur when the echo already IS in normalized form and the two keys coincide — a
    // rewritten echo (server-added fields, different key order or hex case) simply misses here
    // and falls through to the normalized lookup.
    const bucket = this._byEchoId.get(JSON.stringify(echo)) ?? this._byEchoId.get(requestToId(echo));
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

/**
 * Builds an entry's echo-matching data with `specificity` deferred: the only consumer is the
 * `_findByEcho` fallback scan, which runs solely when the server rewrote the echo, so a
 * verbatim echo never pays the leaf count. The first access computes and caches it.
 */
function echoData(request: unknown): NonNullable<PendingRequest["echo"]> {
  let cached: number | undefined;
  return {
    request,
    // Accessor names bind nothing in the body scope: `specificity` here is the `_id.ts` import.
    get specificity(): number {
      return (cached ??= specificity(request));
    },
  };
}

/**
 * The payload as the one wire serialization produced it, for the `request` field of dispatcher
 * errors: always a plain-data snapshot parsed from the frame, never the live object. `post`
 * envelopes carry it under `request`, subscription envelopes under `subscription`. When the
 * frame was never produced (the serialization itself failed), a safe constant remains and the
 * original is never traversed as a fallback.
 */
function payloadSnapshot(frame: string | undefined, post: boolean): unknown {
  if (frame === undefined) return UNSERIALIZABLE_REQUEST;
  const parsed = JSON.parse(frame) as Record<string, unknown>;
  return post ? parsed.request : parsed.subscription;
}
