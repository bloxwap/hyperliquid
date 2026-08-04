/**
 * HTTP transport for executing requests to the Hyperliquid API.
 *
 * Use {@link HttpTransport} for simple requests via HTTP POST.
 *
 * ---
 *
 * ```text
 * HttpTransport.request():
 *   rateLimit? ◄─ token bucket wait for the request's weight (opt-in; abort-aware; disabled by default)
 *   controller ◄─ timeout / user signal / fetchOptions.signal (none allocated when all are absent)
 *    └─► fetch ┬─► non-OK or non-JSON body ─► HttpRequestError; 429 ─► HttpRateLimitError
 *              └─► parse JSON ┬─► 200-OK `{ type: "error" }` envelope ─► HttpRequestError
 *                             └─► T
 *     catch: classify by reference ─► finally: cancel timer, detach
 * ```
 *
 * @example
 * ```ts
 * import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";
 *
 * const transport = new HttpTransport();
 * const client = new InfoClient({ transport });
 *
 * const mids = await client.allMids();
 * ```
 *
 * @module
 */

import { type IRequestTransport, TransportError } from "../_base.ts";
import * as abort from "../_abort.ts";
import { redactSignature, UNSERIALIZABLE_REQUEST } from "../_redact.ts";
import { TokenBucketRateLimiter } from "../_rateLimiter.ts";

/** Configuration options for the HTTP transport layer. */
export interface HttpTransportOptions {
  /**
   * Indicates this transport uses testnet endpoint.
   *
   * Default: `false`
   */
  isTestnet?: boolean;
  /**
   * Request timeout in ms. Set to `null` to disable.
   *
   * Default: `10_000`
   */
  timeout?: number | null;
  /**
   * Request timeout in ms for the `exchange` endpoint only, overriding {@linkcode HttpTransportOptions.timeout}.
   * Set to `null` to disable the timeout for exchange requests.
   *
   * Order placement shares the endpoint with every other action, so a shorter timeout here bounds
   * how long a hung `/exchange` POST can block an order while info calls keep the global timeout.
   *
   * Default: `undefined` (uses `timeout`)
   */
  exchangeTimeout?: number | null;
  /**
   * Opt-in client-side rate limiter, paced to Hyperliquid's REST weight budget.
   *
   * When set, every request acquires its weight from a token bucket before sending and WAITS
   * (async) while the bucket is empty, instead of failing with HTTP 429 after the fact. Weights
   * follow the server rules: `1 + floor(batchLength / 40)` for exchange batches — the batch
   * length read from the action's `orders`/`cancels`/`modifies` array, unwrapping multi-sig
   * actions — the documented per-`type` weight for info requests (2/20/60), and 40 for explorer
   * requests. Response-size surcharges (per 20/60 returned items, per block on `blockList`) are
   * debited after the response arrives, so later requests wait off the real cost.
   *
   * The wait honors caller aborts and ends before the request timeout is armed, so deliberate
   * throttling never trips {@linkcode HttpTransportOptions.timeout}.
   *
   * Default: `undefined` (no client-side limiting)
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   *
   * const transport = new HttpTransport({ rateLimit: { capacity: 1200, refillPerMinute: 1200 } });
   * ```
   */
  rateLimit?: HttpRateLimitOptions;
  /**
   * Custom API URL for `info` and `exchange` requests.
   *
   * Default: `https://api.hyperliquid.xyz` for mainnet, `https://api.hyperliquid-testnet.xyz` for testnet.
   */
  apiUrl?: string | URL;
  /**
   * Custom RPC URL for `explorer` requests.
   *
   * Default: `https://rpc.hyperliquid.xyz` for mainnet, `https://rpc.hyperliquid-testnet.xyz` for testnet.
   */
  rpcUrl?: string | URL;
  /** A custom {@link https://developer.mozilla.org/en-US/docs/Web/API/RequestInit | RequestInit} that is merged with a fetch request. */
  fetchOptions?: Omit<RequestInit, "body" | "method">;
}

/** Configuration for the HTTP transport's opt-in client-side rate limiter. */
export interface HttpRateLimitOptions {
  /**
   * Maximum burst size, in weight units. The bucket starts full.
   *
   * Default: `1200` (Hyperliquid's per-IP REST budget)
   */
  capacity?: number;
  /**
   * Steady-state refill rate, in weight units per minute.
   *
   * Default: `1200` (Hyperliquid's per-IP REST budget)
   */
  refillPerMinute?: number;
}

/** Mainnet API URL. */
export const MAINNET_API_URL = "https://api.hyperliquid.xyz";
/** Testnet API URL. */
export const TESTNET_API_URL = "https://api.hyperliquid-testnet.xyz";
/** Mainnet RPC URL. */
export const MAINNET_RPC_URL = "https://rpc.hyperliquid.xyz";
/** Testnet RPC URL. */
export const TESTNET_RPC_URL = "https://rpc.hyperliquid-testnet.xyz";

/**
 * Error thrown when an HTTP request fails.
 *
 * @example
 * ```ts
 * import { HttpRequestError, HttpTransport } from "@bloxwap/hyperliquid";
 *
 * const transport = new HttpTransport();
 * try {
 *   // Throws on a non-OK response, a 200-OK `{ type: "error" }` envelope, a timeout,
 *   // an abort, or a network failure.
 *   await transport.request("info", { type: "allMids" });
 * } catch (error) {
 *   if (error instanceof HttpRequestError) {
 *     console.error(error.message, error.response?.status);
 *   }
 * }
 * ```
 */
export class HttpRequestError extends TransportError {
  /** The HTTP response that caused the error. */
  response?: Response;
  /** The HTTP status code of the response, when one was received. */
  status?: number;
  /**
   * The request payload as it went over the wire, if available: a snapshot of the exact
   * serialization the transport sent, with every `signature`/`signatures` value replaced by
   * `"0x<redacted>"` — at any depth, including multi-sig `action.signatures` — so logging or
   * forwarding the error cannot leak them. It is always a plain-data copy, never the live
   * object (getters, proxies, and `toJSON` run exactly once, inside the serialization itself);
   * when the payload could not be serialized at all, it is the constant
   * `"[unserializable request]"`.
   */
  request?: unknown;

  /**
   * Creates an HTTP request error.
   *
   * The message is the response status line, extended with `detail` when given;
   * without a response, `detail` alone or a description of `cause` is used.
   *
   * `signatureFree` asserts that `request` carries no `signature`/`signatures` value anywhere,
   * letting the constructor skip the redaction walk. The transports set it only after scanning
   * the serialized wire form for a `"signature"` key; leave it unset for a payload of unknown
   * provenance, so every `request` is walked and redacted.
   */
  constructor(
    options?: ErrorOptions & { detail?: string; response?: Response; request?: unknown; signatureFree?: boolean },
  ) {
    const { detail, response, request, signatureFree, ...errorOptions } = options ?? {};

    let message: string;
    if (response) {
      message = `${response.status} ${response.statusText}`.trim();
      if (detail) message += ` - ${detail}`;
    } else if (detail) {
      message = detail;
    } else {
      const cause = errorOptions.cause;
      message =
        cause === undefined
          ? "Unknown HTTP request error"
          : `Unknown HTTP request error: ${cause instanceof Error ? cause.message : String(cause)}`;
    }

    super(message, errorOptions);
    this.name = "HttpRequestError";
    this.response = response;
    this.status = response?.status;
    this.request = signatureFree === true ? request : redactSignature(request);
  }
}

/**
 * Error thrown when an HTTP request fails with a `429 Too Many Requests` response.
 *
 * Extends {@linkcode HttpRequestError}, so existing `instanceof HttpRequestError` checks keep
 * matching; catch this subclass specifically to back off instead of surfacing a failure. Hyperliquid
 * answers rate-limit violations with 429 and ultimately bans repeat offenders' IPs, so backing off
 * on this error matters — or enable the transport's {@linkcode HttpTransportOptions.rateLimit} to
 * pace requests before they ever reach the limit.
 *
 * @example
 * ```ts
 * import { HttpRateLimitError, HttpTransport } from "@bloxwap/hyperliquid";
 *
 * const transport = new HttpTransport();
 * try {
 *   await transport.request("info", { type: "allMids" });
 * } catch (error) {
 *   if (error instanceof HttpRateLimitError) {
 *     const waitSeconds = error.retryAfter ?? 1;
 *     // back off, then retry
 *   }
 * }
 * ```
 */
export class HttpRateLimitError extends HttpRequestError {
  /**
   * Seconds the server asked to wait before retrying, parsed verbatim from the `Retry-After`
   * response header (delay-seconds, or an HTTP-date in the IMF-fixdate / RFC 850 / asctime
   * form; a date in the past clamps to 0). `undefined` when the header is absent, matches
   * neither RFC 9110 form, or is a `delay-seconds` beyond the safe-integer range.
   */
  retryAfter?: number;

  /**
   * Creates an HTTP 429 error.
   *
   * Accepts the same options as {@linkcode HttpRequestError}.
   */
  constructor(
    options?: ErrorOptions & { detail?: string; response?: Response; request?: unknown; signatureFree?: boolean },
  ) {
    super(options);
    this.name = "HttpRateLimitError";
    this.retryAfter = parseRetryAfter(options?.response?.headers.get("Retry-After") ?? null);
  }
}

/**
 * HTTP transport for the Hyperliquid API.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 *
 * const transport = new HttpTransport();
 * const mids = await transport.request("info", { type: "allMids" });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint
 */
export class HttpTransport implements IRequestTransport<"info" | "exchange" | "explorer"> {
  /** Indicates this transport uses testnet endpoint. */
  readonly isTestnet: boolean;
  /** Request timeout in ms. Set to `null` to disable. */
  timeout: number | null;
  /**
   * Request timeout in ms for the `exchange` endpoint only, overriding {@linkcode timeout}.
   * Set to `null` to disable the timeout for exchange requests.
   *
   * Default: `undefined` (uses `timeout`)
   */
  exchangeTimeout: number | null | undefined;
  /** Custom API URL for requests. */
  apiUrl: string | URL;
  /** Custom RPC URL for explorer requests. */
  rpcUrl: string | URL;
  /** A custom {@link https://developer.mozilla.org/en-US/docs/Web/API/RequestInit | RequestInit} that is merged with a fetch request. */
  fetchOptions: Omit<RequestInit, "body" | "method">;
  /** Opt-in token-bucket rate limiter; `null` keeps requests unthrottled (the default). */
  private readonly _rateLimit: TokenBucketRateLimiter | null;
  /** Shared request-timeout scheduler: at most one armed native timer, however many requests are in flight. */
  private readonly _timeouts: abort.TimeoutWheel;
  /** Memoized endpoint URLs, keyed by base and endpoint; mutating `apiUrl`/`rpcUrl` simply misses the cache. */
  private readonly _urlCache: Map<string, URL>;

  constructor(options?: HttpTransportOptions) {
    this.isTestnet = options?.isTestnet ?? false;
    this.timeout = options?.timeout === undefined ? 10_000 : options.timeout;
    this.exchangeTimeout = options?.exchangeTimeout;
    this.apiUrl = options?.apiUrl ?? (this.isTestnet ? TESTNET_API_URL : MAINNET_API_URL);
    this.rpcUrl = options?.rpcUrl ?? (this.isTestnet ? TESTNET_RPC_URL : MAINNET_RPC_URL);
    this.fetchOptions = options?.fetchOptions ?? {};
    this._rateLimit =
      options?.rateLimit === undefined
        ? null
        : new TokenBucketRateLimiter(options.rateLimit.capacity ?? 1200, options.rateLimit.refillPerMinute ?? 1200);
    this._timeouts = new abort.TimeoutWheel();
    this._urlCache = new Map();
  }

  /**
   * Sends a request to the Hyperliquid API.
   *
   * Routes to {@linkcode apiUrl} for `info`/`exchange` and {@linkcode rpcUrl} for `explorer`.
   *
   * @param endpoint The API endpoint to send the request to.
   * @param payload The payload to send with the request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return A promise that resolves with the parsed JSON response body.
   *
   * @throws {HttpRequestError} When the HTTP request fails ({@linkcode HttpRateLimitError} on a 429 response) —
   * including when a 200-OK body is Hyperliquid's `{ type: "error", message }` failure envelope, in which case
   * the error message carries the server's own text.
   *
   * @example
   * ```ts
   * import { HttpTransport } from "@bloxwap/hyperliquid";
   *
   * const transport = new HttpTransport();
   * const mids = await transport.request("info", { type: "allMids" });
   * ```
   */
  async request<T>(endpoint: "info" | "exchange" | "explorer", payload: unknown, signal?: AbortSignal): Promise<T> {
    // One controller per request — but only when something can actually abort it: a caller or
    // fetchOptions signal, or a finite timeout. With none of those there is nothing to relay or
    // arm, so no controller, relay, or wheel entry is allocated and fetch runs unsignaled. When
    // the controller exists, the caller's signals relay into it FIRST, so they also cancel a
    // rate-limit wait; the timeout timer is armed only after the wait, so deliberate pacing
    // never trips it; and `finally` detaches everything, so no listener or timer outlives the
    // request.
    const fetchSignal = this.fetchOptions.signal;
    const hasSignal = signal !== undefined || (fetchSignal !== undefined && fetchSignal !== null);
    // Captured now, so the error message reports the value the timer was armed with even
    // if the field is reassigned mid-flight. The exchange endpoint honors its own override.
    const timeoutMs =
      endpoint === "exchange" && this.exchangeTimeout !== undefined ? this.exchangeTimeout : this.timeout;
    // Mirrors the wheel's own disabling rule, so a null/non-finite timeout costs no entry either.
    const hasTimeout = timeoutMs !== null && Number.isFinite(timeoutMs);
    const controller = hasSignal || hasTimeout ? new AbortController() : undefined;
    const detachRelay = controller !== undefined && hasSignal ? abort.relay([signal, fetchSignal], controller) : noop;
    let timeout: ReturnType<typeof abort.scheduleTimeout> | undefined;
    // The one serialization of the payload — wire form, weight source, and error snapshot all
    // derive from it, so getters/proxies/toJSON run exactly once per request.
    let body: string | undefined;
    // The parsed form of `body`, materialized lazily: up front when the limiter needs an
    // info/exchange weight, otherwise only if a response surcharge or an error requires it.
    let snapshot: unknown;

    try {
      // --- Serialize -----------------------------------------------------------
      body = JSON.stringify(payload);

      // --- Rate limiting -------------------------------------------------------
      // Opt-in token bucket: the request waits here for its weight. The wait honors caller
      // aborts through the relayed controller signal; an aborted wait never reaches fetch.
      // The pre-send weight is NOT refunded when the request fails (even on 429): the server
      // bills attempts, and its own accounting of failures is undocumented — keeping the
      // debit is the conservative reading.
      const rateLimit = this._rateLimit;
      if (rateLimit !== null) {
        // The parsed wire form — never the live payload — is the billing source, so
        // getters/proxies/toJSON cannot move the weight off what was actually sent. Explorer
        // requests are a flat 40 whatever the payload, so they skip the parse entirely.
        const weight = endpoint === "explorer" ? 40 : requestWeight(endpoint, (snapshot = JSON.parse(body)));
        await rateLimit.acquire(weight, controller?.signal);
      }

      if (controller !== undefined && hasTimeout) timeout = this._timeouts.schedule(controller, timeoutMs);

      // --- Request init ------------------------------------------------------
      const url = this._endpointUrl(endpoint === "explorer" ? this.rpcUrl : this.apiUrl, endpoint);
      // With default options there is nothing to merge, and a plain headers
      // record avoids allocating Headers instances fetch would normalize anyway.
      const init: RequestInit = isEmptyRequestInit(this.fetchOptions)
        ? {
            body,
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal: controller?.signal,
          }
        : mergeRequestInit(
            {
              body,
              headers: {
                "Content-Type": "application/json",
              },
              method: "POST",
            },
            this.fetchOptions,
            { signal: controller?.signal },
          );

      // --- Send and validate -------------------------------------------------
      const response = await fetch(url, init);
      if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
        const clone = response.clone();
        const text = await response.text().catch(() => undefined); // releases connection, clone stays readable
        // 429 gets its own subclass so callers can back off programmatically.
        const ErrorClass = clone.status === 429 ? HttpRateLimitError : HttpRequestError;
        throw new ErrorClass({
          response: clone,
          detail: text ? truncate(text) : undefined,
          ...errorRequest(body, snapshot),
        });
      }

      // --- Parse -------------------------------------------------------------
      // The try covers ONLY the parse itself: the envelope check below throws HttpRequestError,
      // which this catch would otherwise rewrap as an "Invalid JSON response body".
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new HttpRequestError({
          response: recreateResponse(response, text),
          detail: "Invalid JSON response body",
          cause: error,
          ...errorRequest(body, snapshot),
        });
      }

      // Hyperliquid reports some failures inside a 200 OK: a top-level `{ type: "error", message }`
      // envelope (the explorer/rpc failure shape). Surface it here with the server's own message,
      // instead of handing the envelope to callers as data — where schema-validated methods would
      // fail with a confusing ValidationError and unvalidated ones would return it as a "result".
      // Exchange-level failures use a different envelope — `{ status: "err", response }`, handled
      // at the API layer — so they still resolve here, as do array bodies and objects that merely
      // nest a `type: "error"` somewhere below the top level.
      if (isErrorEnvelope(parsed)) {
        throw new HttpRequestError({
          response: recreateResponse(response, text), // the body stream is already consumed
          detail: typeof parsed.message === "string" ? parsed.message : truncate(text),
          ...errorRequest(body, snapshot),
        });
      }

      // Response-size surcharges can only be billed after the fact: debit the bucket so
      // later requests wait off the real cost instead of the pre-request estimate.
      if (rateLimit !== null && Array.isArray(parsed) && parsed.length > 0) {
        snapshot ??= JSON.parse(body); // explorer skipped the pre-send parse (flat weight 40)
        const surcharge = responseSurcharge(endpoint, snapshot, parsed);
        if (surcharge > 0) rateLimit.charge(surcharge);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof TransportError) throw error;
      if (timeout !== undefined && error === timeout.reason) {
        throw new HttpRequestError({
          detail: `Request timed out after ${timeoutMs} ms`,
          cause: error,
          ...errorRequest(body, snapshot),
        });
      }
      if (controller?.signal.aborted && error === controller.signal.reason) {
        throw new HttpRequestError({
          detail: "Request aborted",
          cause: error,
          ...errorRequest(body, snapshot),
        });
      }
      throw new HttpRequestError({ cause: error, ...errorRequest(body, snapshot) });
    } finally {
      timeout?.cancel();
      detachRelay();
    }
  }

  /** Memoized {@link buildEndpointUrl}: the result only changes when `apiUrl`/`rpcUrl` does. */
  private _endpointUrl(base: string | URL, endpoint: string): URL {
    const key = `${base}${endpoint}`;
    let url = this._urlCache.get(key);
    if (url === undefined) {
      url = buildEndpointUrl(base, endpoint);
      this._urlCache.set(key, url);
    }
    return url;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Truncates `text` to `limit` characters, appending the original length. */
function truncate(text: string, limit = 1024): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… (${text.length} chars total)`;
}

/**
 * True when a parsed 200-OK body is Hyperliquid's failure envelope: a top-level non-array object
 * with `type === "error"` (the explorer/rpc shape, `{ type: "error", message: string }`). Only
 * the top level is inspected — a `type: "error"` nested inside a normal response never matches —
 * and `JSON.parse` output aside, the explicit array guard keeps an array with a stray `type`
 * property from matching either.
 */
function isErrorEnvelope(body: unknown): body is { type: "error"; message?: unknown } {
  return isRecord(body) && !Array.isArray(body) && body.type === "error";
}

// --- Rate-limit weights -------------------------------------------------------
// The tables below mirror the official documentation; keep them in sync with it.
// https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits

/**
 * The error options carrying the request: the parsed form of the one wire serialization, so it
 * is always a plain-data snapshot — never the live payload (getters, proxies, and stateful
 * `toJSON` run exactly once, inside the serialization itself). When serialization failed there
 * is no snapshot, and the original is never traversed as a fallback: a safe constant remains.
 *
 * `signatureFree` comes from scanning the wire string for a `"signature` key (a prefix of
 * `"signatures"` too): `JSON.stringify` always emits keys quoted, so a signature-bearing payload
 * cannot slip past, and the signature-free majority — every info request — skips the error
 * constructor's redaction walk.
 */
function errorRequest(body: string | undefined, snapshot: unknown): { request: unknown; signatureFree: boolean } {
  if (body === undefined) return { request: UNSERIALIZABLE_REQUEST, signatureFree: true };
  return {
    request: snapshot !== undefined ? snapshot : JSON.parse(body),
    signatureFree: !body.includes('"signature'),
  };
}

/** Info requests with weight 2. */
const INFO_WEIGHT_2: ReadonlySet<string> = new Set([
  "l2Book",
  "allMids",
  "clearinghouseState",
  "orderStatus",
  "spotClearinghouseState",
  "exchangeStatus",
]);

/** Info requests with weight 60. */
const INFO_WEIGHT_60: ReadonlySet<string> = new Set(["userRole"]);

/** Info endpoints surcharged 1 extra weight per 20 items returned in the response. */
const INFO_SURCHARGE_PER_20_ITEMS: ReadonlySet<string> = new Set([
  "recentTrades",
  "historicalOrders",
  "userFills",
  "userFillsByTime",
  "fundingHistory",
  "userFunding",
  "nonUserFundingUpdates",
  "twapHistory",
  "userTwapSliceFills",
  "userTwapSliceFillsByTime",
  "delegatorHistory",
  "delegatorRewards",
  "validatorStats",
]);

/** Info endpoints surcharged 1 extra weight per 60 items returned in the response. */
const INFO_SURCHARGE_PER_60_ITEMS: ReadonlySet<string> = new Set(["candleSnapshot"]);

/**
 * Weight of a request under Hyperliquid's REST rate limits, billed before sending: the
 * documented per-`type` weight for info requests (2/20/60), 40 for explorer requests, and
 * `1 + floor(batchLength / 40)` for exchange requests. Weights that depend on the response
 * size cannot be known here — see {@linkcode responseSurcharge}.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
 */
function requestWeight(endpoint: "info" | "exchange" | "explorer", payload: unknown): number {
  if (endpoint === "explorer") return 40;
  if (endpoint === "info") {
    const type = payloadType(payload);
    if (type !== undefined && INFO_WEIGHT_2.has(type)) return 2;
    if (type !== undefined && INFO_WEIGHT_60.has(type)) return 60;
    return 20; // all other documented info requests
  }
  return exchangeWeight(payload);
}

/**
 * Exchange weight: `1 + floor(batchLength / 40)`, the batch length read from the action's
 * `orders`/`cancels`/`modifies` array. Actions without such a batch cost the documented
 * minimum of 1.
 *
 * The three keys are the DOCUMENTED batch subset: other actions carry arrays that are not
 * batch-billed (`spotDeploy`/`perpDeploy` payloads, the multi-sig `signatures` array), so a
 * generic "first array" rule would mis-bill them. Whether the protocol's `batch_length` covers
 * anything beyond these three is tracked in https://github.com/bloxwap/hyperliquid/issues/49.
 */
function exchangeWeight(payload: unknown): number {
  const action = exchangeAction(payload);
  if (action === undefined) return 1;
  for (const key of ["orders", "cancels", "modifies"] as const) {
    const batch = action[key];
    if (Array.isArray(batch)) return 1 + Math.floor(batch.length / 40);
  }
  return 1;
}

/** The action carrying the batch: the payload's `action`, unwrapped one level for multi-sig. */
function exchangeAction(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !isRecord(payload.action)) return undefined;
  const action = payload.action;
  // A multi-sig action wraps the real one: { type: "multiSig", signatures, payload: { ..., action } }.
  if (action.type === "multiSig" && isRecord(action.payload) && isRecord(action.payload.action)) {
    return action.payload.action;
  }
  return action;
}

/**
 * Additional weight that only becomes knowable once the response arrives, debited
 * post-response (see {@linkcode TokenBucketRateLimiter.charge}): 1 per 20 returned items on the
 * documented info endpoints, 1 per 60 on `candleSnapshot`, and 1 per block on explorer
 * `blockList`. Post-hoc accounting keeps the limiter honest on average: the response array is
 * the item count the server bills by.
 *
 * Two readings are interpretations the docs do not pin down (tracked in
 * https://github.com/bloxwap/hyperliquid/issues/49): the item count is taken as exactly the
 * top-level response array length, and partial chunks round UP (`ceil`, the conservative
 * choice — the docs say neither `ceil` nor `floor`). `blockList` is exact only for recent
 * blocks: the docs warn older blocks "may be weighted more heavily" without giving a formula.
 */
function responseSurcharge(endpoint: "info" | "exchange" | "explorer", payload: unknown, response: unknown): number {
  if (!Array.isArray(response) || response.length === 0) return 0;
  const type = payloadType(payload);
  if (type === undefined) return 0;
  if (endpoint === "info") {
    if (INFO_SURCHARGE_PER_20_ITEMS.has(type)) return Math.ceil(response.length / 20);
    if (INFO_SURCHARGE_PER_60_ITEMS.has(type)) return Math.ceil(response.length / 60);
  } else if (endpoint === "explorer" && type === "blockList") {
    return response.length; // 1 per block
  }
  return 0;
}

/** The `type` discriminator every Hyperliquid info/exchange/explorer request payload carries. */
function payloadType(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const type = payload.type;
  return typeof type === "string" ? type : undefined;
}

/** True when `value` is a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The three date forms a recipient must accept per RFC 9110 §5.6.7, with every component
// captured: `Date.parse` is too lenient for validation (it ignores weekday tokens, maps 2-digit
// years naively, and rolls invalid components like Feb 31 or minute 60 forward), so the fields
// are validated arithmetically below.
/** IMF-fixdate: `Sun, 06 Nov 1994 08:49:37 GMT`. */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
/** RFC 850: `Sunday, 06-Nov-94 08:49:37 GMT`. */
const RFC850_DATE =
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
/** asctime: `Sun Nov  6 08:49:37 1994` (a single-digit day is padded with a second space). */
const ASCTIME_DATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:(\d{2})| (\d)) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

/** Weekday token (short or long form) to its `Date.getUTCDay()` index. */
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Sunday: 0,
  Mon: 1,
  Monday: 1,
  Tue: 2,
  Tuesday: 2,
  Wed: 3,
  Wednesday: 3,
  Thu: 4,
  Thursday: 4,
  Fri: 5,
  Friday: 5,
  Sat: 6,
  Saturday: 6,
};

/** Month token to its 0-based index. */
const MONTH_INDEX: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/**
 * Parses an HTTP-date in any of the three RFC 9110 recipient forms into epoch milliseconds,
 * validating every component arithmetically: hour ≤ 23, minute ≤ 59, second ≤ 60 (60 is the
 * leap-second marker, read as the final second of the same minute), a real calendar day (no
 * Feb 31), and a weekday token consistent with the computed date. RFC 850's 2-digit year is
 * resolved per the RFC 9110 recipient rule: more than 50 years into the future rolls back one
 * century. Anything invalid yields `undefined`.
 */
function parseHttpDate(value: string): number | undefined {
  let match = IMF_FIXDATE.exec(value);
  if (match !== null) {
    return buildDate(match[1], match[2], match[3], Number(match[4]), match[5], match[6], match[7]);
  }
  match = RFC850_DATE.exec(value);
  if (match !== null) {
    const currentYear = new Date().getUTCFullYear();
    let year = Math.floor(currentYear / 100) * 100 + Number(match[4]);
    if (year > currentYear + 50) year -= 100; // RFC 9110: >50 years out means the previous century
    return buildDate(match[1], match[2], match[3], year, match[5], match[6], match[7]);
  }
  match = ASCTIME_DATE.exec(value);
  if (match !== null) {
    return buildDate(match[1], match[3] ?? match[4], match[2], Number(match[8]), match[5], match[6], match[7]);
  }
  return undefined;
}

/** Validates the captured components and returns the epoch milliseconds for them. */
function buildDate(
  weekday: string,
  dayStr: string,
  monthName: string,
  year: number,
  hourStr: string,
  minuteStr: string,
  secondStr: string,
): number | undefined {
  const day = Number(dayStr);
  const month = MONTH_INDEX[monthName];
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  let second = Number(secondStr);
  if (hour > 23 || minute > 59 || second > 60) return undefined;
  if (second === 60) second = 59; // leap-second marker: the final second of the same minute

  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  // Round-trip validation: any component Date.UTC rolled forward (Feb 31, month 13, an
  // out-of-range day) shows up as a mismatch.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  if (date.getUTCDay() !== WEEKDAY_INDEX[weekday]) return undefined;
  return date.getTime();
}

/**
 * Parses a `Retry-After` header value into seconds, following the RFC 9110 grammar:
 * `delay-seconds` (decimal digits only, optional surrounding whitespace) or an HTTP-date in any
 * of the three recipient forms (IMF-fixdate, RFC 850, asctime).
 *
 * The parsed value is preserved verbatim: `retryAfter` is the server-requested delay, so any
 * safe-integer result is returned as-is (a date in the past clamps to 0 — the asked moment has
 * already passed). Anything matching neither form yields `undefined` — including a
 * `delay-seconds` beyond the safe-integer range, which `Number` would silently round or
 * overflow into an immediate retry.
 *
 * Callers scheduling from this value must apply their own bounds — the SDK's only internal
 * scheduler (the rate-limit bucket) slices timer waits at 2^31-1 ms for exactly that reason.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds)) return undefined;
    return seconds;
  }
  const date = parseHttpDate(trimmed);
  if (date === undefined) return undefined;
  return Math.max(0, (date - Date.now()) / 1000);
}

/** Resolves an endpoint against a base URL without dropping the base path or query. */
function buildEndpointUrl(base: string | URL, endpoint: string): URL {
  const baseUrl = new URL(base);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  const url = new URL(endpoint, baseUrl);
  url.search = baseUrl.search; // relative resolution drops the base query
  return url;
}

/** Rebuilds a response whose body has already been consumed, so `error.response` stays readable. */
function recreateResponse(original: Response, text: string): Response {
  return new Response(text || null, {
    status: original.status,
    statusText: original.statusText,
    headers: original.headers,
  });
}

/** Shared no-op used when no abort relay is needed. */
function noop(): void {
  // Intentionally empty; a statement keeps coverage tooling from treating the call as unhit.
  return;
}

/** True when `init` has no own enumerable properties, i.e. merging it would change nothing. */
function isEmptyRequestInit(init: RequestInit): boolean {
  for (const _ in init) return false;
  return true;
}

/** Merges headers inits left to right: a later occurrence of a key overwrites the earlier one. */
function mergeHeadersInit(...inits: HeadersInit[]): Headers {
  if (inits.length === 1) return new Headers(inits[0]); // a single init needs no merging
  const merged = new Headers();
  for (const init of inits) {
    for (const [key, value] of new Headers(init)) {
      merged.set(key, value);
    }
  }
  return merged;
}

/** Merges request inits left to right: `headers` are combined, every other field is last-init-wins. */
function mergeRequestInit(...inits: RequestInit[]): RequestInit {
  const merged: RequestInit = {};
  const headersList: HeadersInit[] = [];

  for (const init of inits) {
    Object.assign(merged, init);
    if (init.headers) headersList.push(init.headers);
  }
  if (headersList.length > 0) merged.headers = mergeHeadersInit(...headersList);

  return merged;
}
