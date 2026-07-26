/**
 * HTTP transport for executing requests to the Hyperliquid API.
 *
 * Use {@link HttpTransport} for simple requests via HTTP POST.
 *
 * ---
 *
 * ```text
 * HttpTransport.request():
 *   rateLimit? ◄─ token bucket waits for the request's weight (opt-in; disabled by default)
 *   controller ◄─ timeout / user signal / fetchOptions.signal
 *    └─► fetch ┬─► non-OK or non-JSON body ─► HttpRequestError; 429 ─► HttpRateLimitError
 *              └─► parse JSON ─► T
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
import { redactSignature } from "../_redact.ts";
import { TokenBucketRateLimiter } from "./_rateLimiter.ts";

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
   * length is read from the action's `orders`/`cancels`/`modifies` array — and the documented
   * minimum of 1 for every other request. The server's per-endpoint info/explorer weights
   * (2–60) are not tabulated; `refillPerMinute` is the knob for info-heavy workloads.
   *
   * The wait happens before the request timeout is armed, so deliberate throttling never trips
   * {@linkcode HttpTransportOptions.timeout}.
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
 *   // Throws on a non-OK response, a timeout, an abort, or a network failure.
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
   * The original request payload that triggered the error, if available.
   *
   * A signed payload (`{ action, signature, nonce }`) is stored as a COPY with the `signature`
   * replaced by `"0x<redacted>"`, so logging or forwarding the error cannot leak it; the object
   * sent to the server is never mutated.
   */
  request?: unknown;

  /**
   * Creates an HTTP request error.
   *
   * The message is the response status line, extended with `detail` when given;
   * without a response, `detail` alone or a description of `cause` is used.
   */
  constructor(options?: ErrorOptions & { detail?: string; response?: Response; request?: unknown }) {
    const { detail, response, request, ...errorOptions } = options ?? {};

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
    this.request = redactSignature(request);
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
   * Seconds the server asked to wait before retrying, parsed from the `Retry-After` response
   * header; `undefined` when the header is absent or unparseable.
   */
  retryAfter?: number;

  /**
   * Creates an HTTP 429 error.
   *
   * Accepts the same options as {@linkcode HttpRequestError}.
   */
  constructor(options?: ErrorOptions & { detail?: string; response?: Response; request?: unknown }) {
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
  /** Memoized endpoint URLs, keyed by base and endpoint; mutating `apiUrl`/`rpcUrl` simply misses the cache. */
  private readonly _urlCache = new Map<string, URL>();

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
   * @throws {HttpRequestError} When the HTTP request fails ({@linkcode HttpRateLimitError} on a 429 response).
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
    // Opt-in rate limiting, ahead of any timeout wiring: a throttled request waits here for its
    // weight, so deliberate pacing never trips the request timeout. `null` costs one branch.
    const rateLimit = this._rateLimit;
    if (rateLimit !== null) await rateLimit.acquire(requestWeight(endpoint, payload));

    // One controller per request: the timeout timer and all user signals relay into it,
    // and `finally` detaches everything, so no listener or timer outlives the request.
    const controller = new AbortController();
    // Captured now, so the error message reports the value the timer was armed with even
    // if the field is reassigned mid-flight. The exchange endpoint honors its own override.
    const timeoutMs =
      endpoint === "exchange" && this.exchangeTimeout !== undefined ? this.exchangeTimeout : this.timeout;
    const timeout = abort.scheduleTimeout(controller, timeoutMs);
    const fetchSignal = this.fetchOptions.signal;
    const detachRelay =
      signal !== undefined || (fetchSignal !== undefined && fetchSignal !== null)
        ? abort.relay([signal, fetchSignal], controller)
        : noop; // no signals to relay, so nothing to wire up

    try {
      // --- Request init ------------------------------------------------------
      const url = this._endpointUrl(endpoint === "explorer" ? this.rpcUrl : this.apiUrl, endpoint);
      // With default options there is nothing to merge, and a plain headers
      // record avoids allocating Headers instances fetch would normalize anyway.
      const init: RequestInit = isEmptyRequestInit(this.fetchOptions)
        ? {
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal: controller.signal,
          }
        : mergeRequestInit(
            {
              body: JSON.stringify(payload),
              headers: {
                "Content-Type": "application/json",
              },
              method: "POST",
            },
            this.fetchOptions,
            { signal: controller.signal },
          );

      // --- Send and validate -------------------------------------------------
      const response = await fetch(url, init);
      if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
        const clone = response.clone();
        const body = await response.text().catch(() => undefined); // releases connection, clone stays readable
        // 429 gets its own subclass so callers can back off programmatically.
        const ErrorClass = clone.status === 429 ? HttpRateLimitError : HttpRequestError;
        throw new ErrorClass({
          response: clone,
          detail: body ? truncate(body) : undefined,
          request: payload,
        });
      }

      // --- Parse -------------------------------------------------------------
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new HttpRequestError({
          response: recreateResponse(response, text),
          detail: "Invalid JSON response body",
          cause: error,
          request: payload,
        });
      }
    } catch (error) {
      if (error instanceof TransportError) throw error;
      if (error === timeout.reason) {
        throw new HttpRequestError({
          detail: `Request timed out after ${timeoutMs} ms`,
          cause: error,
          request: payload,
        });
      }
      if (controller.signal.aborted && error === controller.signal.reason) {
        throw new HttpRequestError({ detail: "Request aborted", cause: error, request: payload });
      }
      throw new HttpRequestError({ cause: error, request: payload });
    } finally {
      timeout.cancel();
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
 * Weight of a request under Hyperliquid's REST rate limits: `1 + floor(batchLength / 40)` for
 * exchange batches — the batch length read from the action's `orders`/`cancels`/`modifies`
 * array — and 1 for everything else. The server's per-endpoint info/explorer weights (2–60) are
 * deliberately not tabulated; actions without such a batch — including multi-sig wrappers, which
 * nest the real action one level down — cost the documented minimum of 1.
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits
 */
function requestWeight(endpoint: "info" | "exchange" | "explorer", payload: unknown): number {
  if (endpoint !== "exchange" || typeof payload !== "object" || payload === null) return 1;
  const action = (payload as { action?: unknown }).action;
  if (typeof action !== "object" || action === null) return 1;
  for (const key of ["orders", "cancels", "modifies"] as const) {
    const batch = (action as Record<string, unknown>)[key];
    if (Array.isArray(batch)) return 1 + Math.floor(batch.length / 40);
  }
  return 1;
}

/**
 * Parses a `Retry-After` header value into seconds, supporting both the delay-seconds and
 * HTTP-date forms; returns `undefined` when the header is absent or unparseable.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
  return undefined;
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
function noop(): void {}

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
