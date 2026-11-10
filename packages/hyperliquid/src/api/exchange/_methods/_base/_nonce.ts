/**
 * Nonce manager for generating unique, monotonically increasing nonces.
 * @module
 */

import { resolveRuntime, type Runtime } from "../../../../transport/runtime.ts";

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

/**
 * Realm-wide nonce state. `Symbol.for` keeps every copy of this module (duplicate package
 * versions, ESM and CJS bundles in one realm) on the same map. Separate OS processes and worker
 * threads have their own `globalThis` and do not share it.
 */
const PROCESS_NONCE_STATE = Symbol.for("@bloxwap/hyperliquid/nonce-state");

/** Nonce manager interface. */
export interface NonceManager {
  /** Returns a unique nonce for the given key, monotonically increasing per key. */
  getNonce(key: string): number;
}

/** Last-issued nonce per key, plus the clock reading of the previous prune scan. */
interface PruneState {
  map: Map<string, number>;
  lastPruneAt: number;
}

/** Shared nonce state for the default manager, plus which module copies have registered. */
interface ProcessNonceState extends PruneState {
  owners: Set<object>;
  duplicateWarned: boolean;
}

/** Distinct per evaluation of this module, so a second copy can tell it is not the first. */
const MODULE_TOKEN: object = {};

/**
 * Returns the realm-wide nonce map, creating it on first use.
 *
 * Warns once when a second copy of the module registers. The copies then share issuance, so two
 * `ExchangeClient`s — or two loaded copies of the SDK — cannot hand the same signer the same
 * millisecond nonce. The warning is the signal that a duplicate install is in the bundle; the
 * shared map is what keeps that duplicate from rejecting orders.
 */
function registerProcessNonceState(): ProcessNonceState {
  const host = globalThis as typeof globalThis & { [PROCESS_NONCE_STATE]?: ProcessNonceState };
  let state = host[PROCESS_NONCE_STATE];
  if (state === undefined) {
    state = { map: new Map(), lastPruneAt: 0, owners: new Set(), duplicateWarned: false };
    host[PROCESS_NONCE_STATE] = state;
  }
  if (!state.owners.has(MODULE_TOKEN)) {
    state.owners.add(MODULE_TOKEN);
    if (state.owners.size > 1 && !state.duplicateWarned) {
      state.duplicateWarned = true;
      console.warn(
        "[@bloxwap/hyperliquid] More than one copy of this package is loaded in this realm. " +
          "Nonce generation is shared per signer so those copies cannot collide. " +
          "Separate processes and worker threads do not share it; give each its own API wallet " +
          "or pass one coordinated nonceManager.",
      );
    }
  }
  return state;
}

/**
 * Issues `max(now, last + 1)` for `key` and prunes stale entries when the map is over capacity.
 *
 * Evicting a live key is unsafe: the next nonce would fall back to wall-clock time and can go
 * backwards relative to a nonce already sent. A throttled scan only deletes entries the clock
 * has passed, so the next nonce for that key is still strictly greater.
 */
function issueNonce(state: PruneState, maxEntries: number, now: number, key: string): number {
  // --- Bounded pruning: throttle the scan, never evict -----------------
  // gh issue #7: under burst load nonces run AHEAD of the wall clock
  // (`nonce = last + 1`), so once the map exceeds `maxEntries` the old
  // per-call scan found nothing stale and still walked all n entries on
  // every request — a sustained O(n) tax per order.
  //
  // A throttled scan is chosen over evicting the oldest entry because
  // eviction is unsafe here: dropping a live wallet's entry resets its
  // nonce derivation to wall-clock time, which can go BACKWARDS relative
  // to a nonce already sent, risking a reused nonce or one already
  // below the signer's 100-highest window. Throttling only *delays*
  // deletions that were already safe — an entry is still deleted only
  // when `now > last`, i.e. when the next nonce for that key (at least
  // `now`) is guaranteed to exceed the deleted value — so per-key
  // monotonicity is preserved by construction.
  //
  // The trade-off is memory, never correctness: stale entries may linger
  // up to `PRUNE_INTERVAL_MS` longer than before, and between scans the
  // map can grow past `maxEntries` by the number of distinct keys seen in
  // one interval — the same bound the old code had whenever its scans
  // freed nothing. Per-call work is O(1) except for one scan per second.
  if (state.map.size > maxEntries) {
    // A negative delta means wall time stepped backwards (NTP correction, host clock fix).
    // Without that arm the throttle would stall pruning until real time caught up again —
    // potentially hours — so the map would grow unchecked for the whole excursion.
    const sinceLastPrune = now - state.lastPruneAt;
    if (sinceLastPrune >= PRUNE_INTERVAL_MS || sinceLastPrune < 0) {
      state.lastPruneAt = now;
      for (const [k, last] of state.map) {
        if (now > last) state.map.delete(k);
      }
    }
  }
  const last = state.map.get(key) ?? 0;
  const nonce = now > last ? now : last + 1;
  state.map.set(key, nonce);
  return nonce;
}

/**
 * Creates a nonce manager that issues unique, monotonically increasing nonces per key.
 *
 * Uses the runtime's wall clock (`Date.now()` by default) in ms; if the previous nonce for the
 * key is greater than or equal to it, increments by 1 to maintain monotonicity.
 *
 * This manager is private to the caller. The SDK's default manager is {@linkcode globalNonceManager},
 * which is shared by every copy of the package in the realm. Pass the result as `nonceManager`
 * only when this process must coordinate with another process or worker — those do not share
 * `globalNonceManager`.
 *
 * To bound memory under high-cardinality workloads (e.g., a server proxying many wallets),
 * stale entries are pruned when the internal map grows beyond `maxEntries`. An entry is
 * considered stale if the wall clock has advanced past its last issued nonce. The prune scan is
 * throttled to at most one full pass per {@linkcode PRUNE_INTERVAL_MS}, so an over-capacity map
 * does not turn every call into an O(n) sweep.
 *
 * @param maxEntries Upper bound on map size before stale entries are pruned. Default: `10000`.
 * @param runtime Clock overrides; only `now` (wall time) is read, since nonces are timestamps.
 * @return A {@linkcode NonceManager}.
 */
export function createNonceManager(maxEntries: number = DEFAULT_MAX_ENTRIES, runtime?: Partial<Runtime>): NonceManager {
  // `undefined` keeps the default (process-wide) manager on a direct `Date.now()` call: this runs
  // once per signed action, and the global manager is created before any test could inject one.
  const clock = runtime === undefined ? undefined : resolveRuntime(runtime);
  const state: PruneState = { map: new Map(), lastPruneAt: 0 };
  return {
    getNonce(key: string): number {
      const now = clock === undefined ? Date.now() : clock.now();
      return issueNonce(state, maxEntries, now, key);
    },
  };
}

/**
 * Default nonce manager, shared by every `ExchangeClient` and every copy of this module in the
 * realm. Keyed by the caller (`address:isTestnet`): mainnet and testnet are separate exchanges.
 *
 * Not shared across OS processes or worker threads. A deployment that signs for one wallet from
 * more than one of those must give each its own API wallet or pass a coordinated `nonceManager`.
 */
// Module init registers this copy on the realm-wide map. Not marked pure: the registration is
// the side effect that lets a second copy of the module find the same map.
export const globalNonceManager: NonceManager = (() => {
  const state = registerProcessNonceState();
  return {
    getNonce(key: string): number {
      return issueNonce(state, DEFAULT_MAX_ENTRIES, Date.now(), key);
    },
  };
})();
