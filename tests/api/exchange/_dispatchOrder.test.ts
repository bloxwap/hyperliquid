/**
 * Tests for the per-wallet dispatch order guaranteed by `executeWithShell`.
 *
 * The server requires a wallet's exchange requests to reach it in strictly increasing nonce order.
 * The nonce lock only fixes the order nonces are ISSUED in; signing happens outside it so that
 * concurrent callers on one wallet — where signing is a network round trip for any remote wallet —
 * can sign at the same time. A per-wallet dispatch chain is what restores wire order afterwards.
 *
 * That makes the interesting cases the ones where signing finishes out of order, and the ones where
 * a request never reaches the wire at all: a burned nonce must leave a gap (which the server
 * tolerates) without either stalling later requests or letting them overtake an earlier nonce that
 * is still being signed.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals } from "@jsr/std__assert";

import { executeWithShell } from "../../../src/api/exchange/_methods/_base/_shell.ts";

// ============================================================
// Helpers
// ============================================================

/** Records the nonce of every request that reaches the transport, in wire order. */
interface Harness {
  config: never;
  dispatched: number[];
}

function createHarness(): Harness {
  const dispatched: number[] = [];
  const config = {
    transport: {
      isTestnet: false,
      request: async (_endpoint: string, body: { nonce: number }) => {
        dispatched.push(body.nonce);
        // A response that settles later than the next caller's dispatch, so a serialized
        // implementation would be visible as reordering rather than hidden by timing.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { status: "ok", response: { type: "default" } };
      },
    },
    // Minimal viem local-account shape: callable `signTypedData` plus a string address.
    wallet: {
      address: "0x1111111111111111111111111111111111111111" as const,
      signTypedData: async (_params: unknown): Promise<`0x${string}`> => `0x${"11".repeat(65)}` as `0x${string}`,
    },
  } as never;
  return { config, dispatched };
}

/**
 * Fires `count` concurrent requests whose signing takes `delayFor(i)` ms, optionally failing the
 * one at `failAt`. `i` is assigned in the order signing STARTS, which is the order nonces were
 * issued in.
 */
async function runConcurrent(
  harness: Harness,
  count: number,
  delayFor: (index: number) => number,
  failAt?: number,
): Promise<PromiseSettledResult<unknown>[]> {
  let index = 0;
  return await Promise.allSettled(
    Array.from({ length: count }, () =>
      executeWithShell(harness.config, async (_nonce) => {
        const mine = index++;
        await new Promise((resolve) => setTimeout(resolve, delayFor(mine)));
        if (mine === failAt) throw new Error("signing failed");
        return { action: { type: "test" }, signature: { r: "0x0", s: "0x0", v: 27 }, extras: {} };
      }),
    ),
  );
}

/** Asserts the recorded wire order is strictly increasing. */
function assertStrictlyIncreasing(dispatched: number[], context: string): void {
  for (let i = 1; i < dispatched.length; i++) {
    assert(
      dispatched[i]! > dispatched[i - 1]!,
      `${context}: nonce ${dispatched[i]} reached the wire after ${dispatched[i - 1]} (order: ${dispatched.join(", ")})`,
    );
  }
}

// ============================================================
// Tests
// ============================================================

describe("executeWithShell dispatch order", () => {
  test("holds when signatures complete in reverse order", async () => {
    const harness = createHarness();
    // The first nonce signs slowest and the last signs fastest, so completion order is the exact
    // reverse of issue order — the case a naive "dispatch when signed" implementation gets wrong.
    await runConcurrent(harness, 10, (i) => (10 - i) * 10);

    assertEquals(harness.dispatched.length, 10);
    assertStrictlyIncreasing(harness.dispatched, "reversed signing order");
  });

  test("holds under jittered signing latency", async () => {
    const harness = createHarness();
    const jitter = [37, 3, 21, 8, 44, 12, 29, 1, 17, 33];
    await runConcurrent(harness, 10, (i) => jitter[i]!);

    assertEquals(harness.dispatched.length, 10);
    assertStrictlyIncreasing(harness.dispatched, "jittered signing order");
  });

  test("a failed signature leaves a nonce gap without stalling or reordering the rest", async () => {
    // Each position matters: failing first, in the middle, and last exercise different sides of
    // the chain — in particular that a burned nonce still waits its turn before releasing, so a
    // later request cannot overtake an earlier one that is still signing.
    for (const failAt of [0, 3, 7]) {
      const harness = createHarness();
      const results = await runConcurrent(harness, 8, (i) => (8 - i) * 8, failAt);

      assertEquals(results.filter((r) => r.status === "rejected").length, 1, `failAt=${failAt}: one rejection`);
      assertEquals(harness.dispatched.length, 7, `failAt=${failAt}: the other seven still dispatch`);
      assertStrictlyIncreasing(harness.dispatched, `failAt=${failAt}`);
    }
  });

  test("signing runs concurrently across callers on one wallet", async () => {
    const harness = createHarness();
    const started = performance.now();
    await runConcurrent(harness, 8, () => 40);
    const elapsed = performance.now() - started;

    assertEquals(harness.dispatched.length, 8);
    assertStrictlyIncreasing(harness.dispatched, "concurrent signing");
    // Serialized signing would cost at least 8 x 40 ms; overlapped it is bounded by one signature
    // plus dispatch. The bound is loose enough to survive a loaded CI runner.
    assert(elapsed < 240, `signing did not overlap: 8 x 40 ms took ${elapsed.toFixed(0)} ms`);
  });

  test("sequential callers still dispatch in order", async () => {
    const harness = createHarness();
    for (let i = 0; i < 5; i++) {
      await executeWithShell(harness.config, async (_nonce) => {
        return { action: { type: "test" }, signature: { r: "0x0", s: "0x0", v: 27 }, extras: {} };
      });
    }

    assertEquals(harness.dispatched.length, 5);
    assertStrictlyIncreasing(harness.dispatched, "sequential callers");
  });
});
