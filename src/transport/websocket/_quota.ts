/**
 * The per-IP budget every WebSocket connection to one Hyperliquid deployment shares.
 *
 * Hyperliquid scopes **every** documented WebSocket limit to the client IP, not to the
 * connection — two of them say so in their own text ("across all websocket connections"):
 *
 * | Limit                          | Value          | Scope                          |
 * | ------------------------------ | -------------- | ------------------------------ |
 * | Subscriptions                  | 1000           | per IP                         |
 * | Unique users across user subs  | 14 (see below) | per IP                         |
 * | Messages sent to Hyperliquid   | 2000/minute    | per IP, across all connections |
 * | Simultaneous inflight posts     | 100            | per IP, across all connections |
 *
 * A budget tracked per {@linkcode WebSocketSubscriptionManager} therefore counts the wrong
 * thing: two transports in one process each admitted 1000 subscriptions against a limit of
 * 1000 total, and the excess was refused by the server rather than by the guard. That
 * refusal is the expensive kind — the server's `error` frame carries no echoed request, so
 * it cannot be matched to the pending subscribe and surfaces only when the request times
 * out, ten seconds later, as a timeout rather than as a limit.
 *
 * One instance of this class is shared by every transport pointed at the same deployment
 * (see {@linkcode sharedWebSocketQuota}), so the counts the guards read are the counts the
 * server keeps. That shared instance also paces outbound messages against the 2000/minute
 * budget by default: the default transport is exactly the one that overruns it, since at the
 * 1000-subscription cap one reconnect re-sends every subscribe frame instantly and a flapping
 * socket repeats the burst. A directly constructed `new WebSocketQuota()` stays
 * accounting-only, which is the opt-out (pass it via `WebSocketTransportOptions.quota`).
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
 * @module
 */

import { TokenBucketRateLimiter } from "../_rateLimiter.ts";

// =============================================================================
// Documented limits
// =============================================================================

/**
 * Maximum concurrent subscriptions per IP; the server rejects the excess without echoing
 * the request, so the guard must run client-side.
 */
const MAX_SUBSCRIPTIONS = 1000;

/**
 * Maximum unique users across user-specific subscriptions per IP; the server rejects the
 * excess without echoing the request, so the guard must run client-side.
 *
 * **14, not 15 — and the server's own error message is what misleads here.** A live mainnet
 * probe on 2026-08-02 subscribed distinct users one at a time on a fresh connection with this
 * guard disabled, twice, on two independent connections: both accepted exactly **14** and had
 * the 15th refused by an `error` frame reading `Cannot track more than 15 total users.` The
 * server enforces one fewer than its message states, so taking that message at face value
 * (as the 2026-07-26 probe recorded in this file's history did) sets the guard one too high —
 * and the 15th subscription is then the worst case of all: it passes the client check, the
 * server drops it *without echoing the request*, nothing can be matched to the pending
 * subscribe, and the caller waits out the full request timeout for what should have been an
 * instant local error.
 *
 * The same probe established the scope: after one connection held 14 users, a **second**
 * connection from the same host was refused a 15th distinct user while still being allowed to
 * subscribe a user the first connection already held. The cap is per IP, not per connection —
 * so sharding user channels across sockets buys no additional user slots.
 *
 * Erring low is the safe direction: refusing one subscription the server might have taken
 * costs a slot, while admitting one it refuses costs a 10 s timeout.
 *
 * (The official docs say 10, which matches neither the message nor the enforcement.)
 */
const MAX_UNIQUE_USERS = 14;

/** Maximum messages sent to Hyperliquid per minute per IP, across every connection. */
const MAX_MESSAGES_PER_MINUTE = 2000;

/** Maximum simultaneous inflight `post` requests per IP, across every connection. */
const MAX_INFLIGHT_POSTS = 100;

// =============================================================================
// Options
// =============================================================================

/** Pacing configuration for outbound WebSocket messages. */
export interface WebSocketRateLimitOptions {
  /**
   * Maximum burst size, in messages. The bucket starts full.
   *
   * Default: `2000`
   */
  capacity?: number;
  /**
   * Steady-state refill rate, in messages per minute.
   *
   * Default: `2000`
   */
  refillPerMinute?: number;
}

/** Configuration options for a {@linkcode WebSocketQuota}. */
export interface WebSocketQuotaOptions {
  /**
   * Pacing of outbound messages against Hyperliquid's 2000-per-minute per-IP budget.
   *
   * When set, `subscribe` and `unsubscribe` frames wait for a token before going out.
   * `post` frames and keep-alive pings never wait — they debit the bucket without blocking
   * (see {@linkcode WebSocketQuota.chargeSend}) — so enabling this can only ever delay
   * subscription traffic, never an order.
   *
   * Default: `undefined` (accounting only; nothing waits). That default governs direct
   * construction only — the {@linkcode sharedWebSocketQuota} instance every transport uses
   * unless given its own is created with pacing enabled (`{}`: capacity 2000, refilling
   * 2000/minute). Opting out of pacing therefore means passing an accounting-only
   * `new WebSocketQuota()` via `WebSocketTransportOptions.quota`.
   */
  rateLimit?: WebSocketRateLimitOptions;
  /**
   * Maximum concurrent subscriptions, or `null` to disable the guard.
   *
   * Default: `1000`
   */
  maxSubscriptions?: number | null;
  /**
   * Maximum unique users across user-specific subscriptions, or `null` to disable the guard.
   *
   * Default: `14`
   */
  maxUniqueUsers?: number | null;
}

/** Why a subscription reservation was refused. */
export type QuotaRefusal = "subscriptions" | "users";

// =============================================================================
// Quota
// =============================================================================

/**
 * The subscription, unique-user and outbound-message budget for one Hyperliquid deployment.
 *
 * Every counter here mirrors a limit the server enforces per IP, so one instance must be
 * shared by every connection that reaches that deployment from this host. Sharing is the
 * default; {@linkcode WebSocketTransportOptions.quota} exists for the cases the default
 * cannot see — a process behind several egress IPs, or a test that wants isolation.
 */
export class WebSocketQuota {
  /** Maximum concurrent subscriptions, or `null` when the guard is disabled. */
  readonly maxSubscriptions: number | null;
  /** Maximum unique users across user-specific subscriptions, or `null` when the guard is disabled. */
  readonly maxUniqueUsers: number | null;
  /** Maximum simultaneous inflight `post` requests the server accepts across all connections. */
  readonly maxInflightPosts: number = MAX_INFLIGHT_POSTS;

  /** Live subscriptions across every connection sharing this quota. */
  private _subscriptions = 0;
  /**
   * Live subscription count per tracked user, maintained incrementally so the unique-user
   * guard stays O(1) per subscribe instead of rescanning every registered id. The map's
   * size — not its summed values — is what the limit applies to.
   */
  private readonly _users: Map<string, number> = new Map();
  /** Outbound message pacer, or `null` when pacing is off and only accounting runs. */
  private readonly _limiter: TokenBucketRateLimiter | null;

  constructor(options?: WebSocketQuotaOptions) {
    this.maxSubscriptions = options?.maxSubscriptions === undefined ? MAX_SUBSCRIPTIONS : options.maxSubscriptions;
    this.maxUniqueUsers = options?.maxUniqueUsers === undefined ? MAX_UNIQUE_USERS : options.maxUniqueUsers;
    this._limiter =
      options?.rateLimit === undefined
        ? null
        : new TokenBucketRateLimiter(
            options.rateLimit.capacity ?? MAX_MESSAGES_PER_MINUTE,
            options.rateLimit.refillPerMinute ?? MAX_MESSAGES_PER_MINUTE,
          );
  }

  // ===========================================================================
  // Subscription budget
  // ===========================================================================

  /** Live subscriptions counted against this quota. */
  get subscriptions(): number {
    return this._subscriptions;
  }

  /** Distinct users counted against this quota. */
  get uniqueUsers(): number {
    return this._users.size;
  }

  /**
   * Reserves one subscription slot, and a user slot when `user` is set.
   *
   * Checking and reserving are one step on purpose: a split check-then-add lets two
   * subscribes interleave between the two halves and both pass a guard only one of them
   * should have. Returns the limit that refused the reservation, or `undefined` when it
   * succeeded — the caller builds the error, so this module stays free of a dependency on
   * the dispatcher's error type.
   *
   * @param user Lowercased user address this subscription tracks, or `undefined` when it tracks none.
   */
  reserveSubscription(user: string | undefined): QuotaRefusal | undefined {
    if (this.maxSubscriptions !== null && this._subscriptions >= this.maxSubscriptions) return "subscriptions";
    // Only a user not already tracked consumes a slot: N subscriptions for one user cost one.
    if (
      user !== undefined &&
      this.maxUniqueUsers !== null &&
      !this._users.has(user) &&
      this._users.size >= this.maxUniqueUsers
    ) {
      return "users";
    }

    this._subscriptions++;
    if (user !== undefined) this._users.set(user, (this._users.get(user) ?? 0) + 1);
    return undefined;
  }

  /**
   * Releases a slot taken by {@linkcode WebSocketQuota.reserveSubscription}.
   *
   * @param user The same value passed to the matching reservation.
   */
  releaseSubscription(user: string | undefined): void {
    if (this._subscriptions > 0) this._subscriptions--;
    if (user === undefined) return;

    const count = this._users.get(user);
    // The count is only ever absent if a reservation was lost, in which case forgetting the
    // user is the safe direction: the server rejects a genuine overflow, a stuck count would
    // wedge the guard closed against subscriptions the server would have accepted.
    if (count === undefined || count <= 1) this._users.delete(user);
    else this._users.set(user, count - 1);
  }

  // ===========================================================================
  // Outbound message budget
  // ===========================================================================

  /**
   * Waits until the outbound budget covers one message, then deducts it.
   *
   * Returns `undefined` — not a resolved promise — whenever the wait is unnecessary: when
   * pacing is off, and on the {@linkcode TokenBucketRateLimiter.tryAcquire} fast path when
   * the bucket covers the message with no queue in front of it. The caller can then skip
   * the `await` entirely and stay synchronous. That distinction is load bearing:
   * `_shell.ts` fixes the wire order of an exchange action on `transport.request` running
   * synchronously up to its first await, so a promise handed back here where none was
   * needed would let a later nonce overtake an earlier one — and with pacing on by default
   * (see {@linkcode sharedWebSocketQuota}), a plain `acquire` would hand back exactly such
   * a promise for every uncontended send.
   *
   * "Unnecessary" is judged by the synchronous probe: in the sliver between a failed probe
   * and the queued `acquire`, the clock can cross a refill boundary and hand back an
   * already-resolved promise instead of `undefined`. That costs the subscribe frame one
   * microtask and nothing else — a `post` never enters this path, so no order can be
   * delayed or reordered by it.
   *
   * Only `subscribe` / `unsubscribe` frames go through this path. See
   * {@linkcode WebSocketQuota.chargeSend} for the frames that must never wait.
   *
   * @param signal Abandons the wait; the caller's request fails rather than sending late.
   */
  acquireSend(signal?: AbortSignal): Promise<void> | undefined {
    if (this._limiter === null) return undefined;
    // An already-aborted caller must not spend budget: its frame will never be sent, and
    // repeated aborted attempts would drain the shared bucket and throttle the legitimate
    // subscription traffic behind it. Mirrors `acquire`'s own already-aborted contract,
    // which the synchronous probe below would otherwise bypass.
    if (signal?.aborted) return Promise.reject(signal.reason);
    // The synchronous probe deducts the token inline whenever it can do so without stealing
    // a queued waiter's turn; only a genuinely empty bucket — or one with a queue in front
    // of it — costs the caller a promise.
    if (this._limiter.tryAcquire(1)) return undefined;
    return this._limiter.acquire(1, signal);
  }

  /**
   * Deducts one message from the outbound budget without waiting.
   *
   * For frames that cannot be delayed without breaking something else:
   * - `post` frames, because an exchange action's wire order is fixed by reaching the socket
   *   synchronously (see {@linkcode WebSocketQuota.acquireSend});
   * - keep-alive pings, because delaying the watchdog is how a half-open socket goes unnoticed.
   *
   * The deduction can drive the bucket into debt, which later `subscribe` frames wait off —
   * so an order burst correctly slows subscription traffic instead of silently overrunning
   * the shared budget.
   */
  chargeSend(): void {
    this._limiter?.charge(1);
  }
}

// =============================================================================
// Shared instances
// =============================================================================

/**
 * The process-wide quota per deployment, created on first use.
 *
 * Keyed by network rather than by URL: mainnet and testnet are different servers keeping
 * different per-IP counters, while a custom `url` almost always points at the same
 * deployment through a proxy. Collapsing a custom URL onto its network's quota therefore
 * errs toward counting *together* — the safe direction, since over-counting refuses a
 * subscription the server would have taken (a clear client-side error) while under-counting
 * produces the unmatched server refusal this whole module exists to avoid.
 */
const SHARED: { mainnet?: WebSocketQuota; testnet?: WebSocketQuota } = {};

/**
 * The quota every transport on `isTestnet` shares unless it was given its own.
 *
 * Created with pacing enabled ({@linkcode WebSocketQuotaOptions.rateLimit} `{}`: capacity
 * 2000, refilling 2000/minute — the server's own budget), because the default transport is
 * exactly the one that trips the limit: at the 1000-subscription cap a single reconnect
 * re-sends every subscribe frame instantly, spending half the minute's budget in one burst,
 * and a socket flapping under `maxRetries: Infinity` repeats it. To opt out of pacing, pass
 * an accounting-only `new WebSocketQuota()` via `WebSocketTransportOptions.quota`.
 */
export function sharedWebSocketQuota(isTestnet: boolean): WebSocketQuota {
  const key = isTestnet ? "testnet" : "mainnet";
  return (SHARED[key] ??= new WebSocketQuota({ rateLimit: {} }));
}
