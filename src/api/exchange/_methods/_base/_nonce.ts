/**
 * Nonce manager for generating unique, monotonically increasing nonces.
 * @module
 */

/** Default upper bound on map size before stale entries are pruned. */
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Minimum wall-clock interval between full prune scans, in milliseconds.
 *
 * Nonces are millisecond-resolution, so an entry can only become stale one millisecond after
 * its last issued nonce; a one-second cadence keeps stale-entry lifetimes short while amortizing
 * the O(n) scan to at most one pass per second regardless of request rate.
 */
const PRUNE_INTERVAL_MS = 1_000;

/** Nonce manager interface. */
export interface NonceManager {
  /** Returns a unique nonce for the given key, monotonically increasing per key. */
  getNonce(key: string): number;
}

/**
 * Creates a nonce manager that issues unique, monotonically increasing nonces per key.
 *
 * Uses `Date.now()` in ms; if the previous nonce for the key is greater than or equal to
 * `Date.now()`, increments by 1 to maintain monotonicity.
 *
 * To bound memory under high-cardinality workloads (e.g., a server proxying many wallets),
 * stale entries are pruned when the internal map grows beyond `maxEntries`. An entry is
 * considered stale if `Date.now()` has advanced past its last issued nonce. The prune scan is
 * throttled to at most one full pass per {@linkcode PRUNE_INTERVAL_MS}, so an over-capacity map
 * does not turn every call into an O(n) sweep.
 *
 * @param maxEntries Upper bound on map size before stale entries are pruned. Default: `10000`.
 * @return A {@linkcode NonceManager}.
 */
export function createNonceManager(maxEntries: number = DEFAULT_MAX_ENTRIES): NonceManager {
  const map = new Map<string, number>();
  let lastPruneAt = 0;
  return {
    getNonce(key: string): number {
      const now = Date.now();
      // --- Bounded pruning: throttle the scan, never evict -----------------
      // gh issue #7: under burst load nonces run AHEAD of the wall clock
      // (`nonce = last + 1`), so once the map exceeds `maxEntries` the old
      // per-call scan found nothing stale and still walked all n entries on
      // every request — a sustained O(n) tax per order.
      //
      // A throttled scan is chosen over evicting the oldest entry because
      // eviction is unsafe here: dropping a live wallet's entry resets its
      // nonce derivation to wall-clock time, which can go BACKWARDS relative
      // to a nonce already sent, and the exchange rejects non-increasing
      // nonces. Throttling only *delays* deletions that were already safe —
      // an entry is still deleted only when `now > last`, i.e. when the next
      // nonce for that key (at least `now`) is guaranteed to exceed the
      // deleted value — so per-key monotonicity is preserved by construction.
      //
      // The trade-off is memory, never correctness: stale entries may linger
      // up to `PRUNE_INTERVAL_MS` longer than before, and between scans the
      // map can grow past `maxEntries` by the number of distinct keys seen in
      // one interval — the same bound the old code had whenever its scans
      // freed nothing. Per-call work is O(1) except for one scan per second.
      if (map.size > maxEntries) {
        // A negative delta means wall time stepped backwards (NTP correction, host clock fix).
        // Without that arm the throttle would stall pruning until real time caught up again —
        // potentially hours — so the map would grow unchecked for the whole excursion.
        const sinceLastPrune = now - lastPruneAt;
        if (sinceLastPrune >= PRUNE_INTERVAL_MS || sinceLastPrune < 0) {
          lastPruneAt = now;
          for (const [k, last] of map) {
            if (now > last) map.delete(k);
          }
        }
      }
      const last = map.get(key) ?? 0;
      const nonce = now > last ? now : last + 1;
      map.set(key, nonce);
      return nonce;
    },
  };
}

/** Default global nonce manager instance. */
export const globalNonceManager: NonceManager = /* @__PURE__ */ createNonceManager();
