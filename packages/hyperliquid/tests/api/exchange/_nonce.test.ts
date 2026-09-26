/**
 * Tests for the internal nonce manager: per-key monotonicity under high-cardinality
 * workloads, and bounded prune work per call once the entry map exceeds capacity
 * (gh issue #7).
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals } from "@jsr/std__assert";

import { createNonceManager, type NonceManager } from "../../../src/api/exchange/_methods/_base/_nonce.ts";

// ============================================================
// Helpers
// ============================================================

/** Formats an index as a wallet-like key, matching how callers key the manager. */
function walletKey(i: number): string {
  return `0x${i.toString(16).padStart(40, "0")}`;
}

/**
 * Runs `fn` with `Date.now` replaced by a controllable clock, restoring it afterwards.
 * A deterministic clock is what lets these tests assert prune behaviour exactly, with no
 * wall-clock timing assertions (which would be flaky in CI).
 */
function withMockClock(start: number, fn: (clock: { now: () => number; advance: (ms: number) => void }) => void): void {
  let now = start;
  const realDateNow = Date.now;
  Date.now = () => now;
  try {
    fn({
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
    });
  } finally {
    Date.now = realDateNow;
  }
}

// The prune throttle in `_nonce.ts` rescans at most once per this interval.
const PRUNE_INTERVAL_MS = 1_000;

/** Prune-scan bookkeeping observed from outside the manager. */
interface PruneCounters {
  /** Full iterations of the entry map — one per prune scan. */
  scans: number;
  /** Entries removed by those scans. */
  deletes: number;
}

/**
 * Builds a nonce manager whose internal entry map counts prune scans and deletions.
 *
 * `createNonceManager` allocates its own `Map` with no injection point, so the global is
 * swapped for an instrumented subclass across that single call and restored immediately —
 * no other map in the process is affected. Counting scans (rather than timing them) is what
 * keeps the bounded-work assertions deterministic instead of flaky in CI.
 */
function managerWithCounters(maxEntries: number): { manager: NonceManager; counters: PruneCounters } {
  const counters: PruneCounters = { scans: 0, deletes: 0 };
  class CountingMap<K, V> extends Map<K, V> {
    override [Symbol.iterator](): MapIterator<[K, V]> {
      counters.scans++;
      return Map.prototype[Symbol.iterator].call(this) as MapIterator<[K, V]>;
    }
    override delete(key: K): boolean {
      counters.deletes++;
      return super.delete(key);
    }
  }

  const realMap = globalThis.Map;
  globalThis.Map = CountingMap as unknown as MapConstructor;
  try {
    return { manager: createNonceManager(maxEntries), counters };
  } finally {
    globalThis.Map = realMap;
  }
}

// ============================================================
// Tests
// ============================================================

describe("createNonceManager", () => {
  test("nonces stay strictly increasing per key beyond maxEntries, ahead of wall clock", () => {
    withMockClock(1_700_000_000_000, (clock) => {
      const manager = createNonceManager(); // default maxEntries: 10_000
      const keyCount = 12_000; // over capacity, so the prune path is active throughout
      const lastNonce = new Map<string, number>();

      // Three rounds against a frozen clock: round one issues `now`, later rounds must
      // increment past it, so nonces run strictly ahead of wall-clock time — the regime
      // in which a prune scan can never free anything.
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < keyCount; i++) {
          const key = walletKey(i);
          const nonce = manager.getNonce(key);
          const prev = lastNonce.get(key);
          if (prev !== undefined) {
            assert(nonce > prev, `nonce for ${key} went backwards: ${prev} -> ${nonce}`);
            assert(nonce > clock.now(), `nonce for ${key} should be ahead of the frozen clock`);
          }
          lastNonce.set(key, nonce);
        }
      }

      // Let wall clock jump forward; previously issued nonces must still be exceeded.
      clock.advance(60_000);
      for (let i = 0; i < keyCount; i++) {
        const key = walletKey(i);
        const nonce = manager.getNonce(key);
        assert(nonce > lastNonce.get(key)!, `nonce for ${key} went backwards after clock advance`);
        lastNonce.set(key, nonce);
      }
    });
  });

  test("over-capacity prune work per call is bounded, independent of map size", () => {
    withMockClock(1_700_000_000_000, (clock) => {
      const maxEntries = 100;
      const keyCount = 500; // 5x over capacity
      const { manager, counters } = managerWithCounters(maxEntries);

      // Fill past capacity with a frozen clock. The first over-capacity call pays for one
      // scan (which frees nothing: every entry's nonce equals `now`, none are stale);
      // every subsequent call within the interval must be scan-free.
      for (let i = 0; i < keyCount; i++) manager.getNonce(walletKey(i));
      assertEquals(counters.scans, 1, "expected exactly one scan when the map first exceeds maxEntries");
      assertEquals(counters.deletes, 0, "no entry is stale at frozen wall clock, so nothing may be deleted");

      // Hammer the manager far beyond capacity with nonces ahead of the wall clock.
      // With the old per-call scan this loop would add one full O(n) scan per call.
      const calls = 2_000;
      for (let i = 0; i < calls; i++) manager.getNonce(walletKey(i % keyCount));
      assertEquals(
        counters.scans,
        1,
        `scans must not grow with call count or map size (${counters.scans} scans after ${calls} calls)`,
      );
      assertEquals(counters.deletes, 0);

      // Advancing the clock past the prune interval re-arms exactly one scan, and that
      // scan must still reclaim every stale entry — throttling delays pruning, it does
      // not disable it.
      const preEvictionNonce = manager.getNonce(walletKey(0));
      clock.advance(PRUNE_INTERVAL_MS);
      const postEvictionNonce = manager.getNonce(walletKey(0));
      assertEquals(counters.scans, 2, "expected one rescan after the prune interval elapsed");
      assertEquals(counters.deletes, keyCount, "the rescan must reclaim all stale entries");

      // An evicted entry derives its next nonce from wall-clock time. Because eviction is
      // only ever allowed once `now > last`, that wall-clock nonce is guaranteed to exceed
      // every nonce issued for the key before eviction — monotonicity survives pruning.
      assertEquals(postEvictionNonce, clock.now());
      assert(postEvictionNonce > preEvictionNonce, "nonce after eviction must exceed pre-eviction nonces");
    });
  });

  test("a backwards clock step does not stall pruning", () => {
    withMockClock(1_700_000_000_000, (clock) => {
      const maxEntries = 100;
      const keyCount = 500;
      const { manager, counters } = managerWithCounters(maxEntries);

      for (let i = 0; i < keyCount; i++) manager.getNonce(walletKey(i));
      assertEquals(counters.scans, 1);

      // An NTP correction steps wall time back an hour. A throttle comparing
      // `now - lastPruneAt >= interval` alone would now wait an hour before pruning again,
      // leaving the map to grow unchecked for the whole excursion.
      clock.advance(-3_600_000);
      const nonce = manager.getNonce(walletKey(0));
      assertEquals(counters.scans, 2, "a backwards clock step must re-arm the prune scan immediately");

      // Nothing may be reclaimed here: every entry was issued at the *later* pre-step time,
      // so no entry satisfies `now > last` and the map is still fully live. This is exactly
      // why the scan predicate — not the throttle — is what guarantees monotonicity.
      assertEquals(counters.deletes, 0, "entries issued after the current clock reading are not stale");
      assert(nonce > 1_700_000_000_000, "the pre-step nonce must still be exceeded, not reissued from wall clock");
    });
  });
});
