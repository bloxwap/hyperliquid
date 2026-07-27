/**
 * Tests for the abort wiring helpers: the multi-source relay's manual listener bookkeeping
 * (listeners are added with `once: true` and removed by a detach loop, an already-aborted
 * source fires immediately, and spent/null sources are skipped) and the {@linkcode TimeoutWheel}
 * shared timeout scheduler (deadline ordering, clear-on-settle, the single armed native timer).
 * @module
 */

import { afterEach, beforeEach, describe, test } from "bun:test";
import { assert, assertEquals, assertIsError, assertStrictEquals } from "@jsr/std__assert";
import { FakeTime } from "@jsr/std__testing/time";
import { relay, TimeoutWheel } from "../../src/transport/_abort.ts";

/** A live AbortController's signal, aborted with `reason` when given. */
function source(reason?: Error): AbortSignal {
  const controller = new AbortController();
  if (reason !== undefined) controller.abort(reason);
  return controller.signal;
}

describe("abort.relay", () => {
  describe("no sources", () => {
    test("returns a noop detach", () => {
      const target = new AbortController();
      const detach = relay([], target);
      detach();
      assert(!target.signal.aborted);
    });

    test("null and undefined entries alone count as no sources", () => {
      const target = new AbortController();
      const detach = relay([null, undefined], target);
      detach();
      assert(!target.signal.aborted);
    });
  });

  describe("single source", () => {
    test("relays the abort with the source's reason", () => {
      const target = new AbortController();
      const controller = new AbortController();
      relay([controller.signal], target);

      const reason = new Error("boom");
      controller.abort(reason);
      assert(target.signal.aborted);
      assertStrictEquals(target.signal.reason, reason);
    });

    test("detach stops the relay", () => {
      const target = new AbortController();
      const controller = new AbortController();
      const detach = relay([controller.signal], target);

      detach();
      controller.abort(new Error("boom"));
      assert(!target.signal.aborted);
    });

    test("an already-aborted source fires immediately", () => {
      const target = new AbortController();
      const reason = new Error("pre-aborted");
      const detach = relay([source(reason)], target);

      assert(target.signal.aborted);
      assertStrictEquals(target.signal.reason, reason);
      detach(); // nothing was attached; must not throw
    });
  });

  describe("multiple sources", () => {
    test("the first source to abort wins the target's reason", () => {
      const target = new AbortController();
      const a = new AbortController();
      const b = new AbortController();
      relay([a.signal, b.signal], target);

      const reasonA = new Error("A");
      a.abort(reasonA);
      assert(target.signal.aborted);
      assertStrictEquals(target.signal.reason, reasonA);

      // The `once` listener is spent and the target already aborted: a later
      // source abort changes nothing.
      b.abort(new Error("B"));
      assertStrictEquals(target.signal.reason, reasonA);
    });

    test("detach removes every source listener", () => {
      const target = new AbortController();
      const a = new AbortController();
      const b = new AbortController();
      const detach = relay([a.signal, b.signal], target);

      detach();
      a.abort(new Error("A"));
      b.abort(new Error("B"));
      assert(!target.signal.aborted);
    });

    test("detach after a source fired removes the remaining listeners", () => {
      const target = new AbortController();
      const a = new AbortController();
      const b = new AbortController();
      const detach = relay([a.signal, b.signal], target);

      const reasonA = new Error("A");
      a.abort(reasonA);
      detach(); // a's listener was removed by `once`; b's by the loop
      b.abort(new Error("B"));
      assertStrictEquals(target.signal.reason, reasonA);
    });

    test("an already-aborted source fires immediately, skipping later sources", () => {
      const target = new AbortController();
      const a = new AbortController();
      const reasonB = new Error("pre-aborted B");
      const c = new AbortController();
      const detach = relay([a.signal, source(reasonB), c.signal], target);

      assert(target.signal.aborted);
      assertStrictEquals(target.signal.reason, reasonB);
      // Detach must still remove the listener attached before the aborted source.
      detach();
      a.abort(new Error("A"));
      c.abort(new Error("C"));
      assertStrictEquals(target.signal.reason, reasonB);
    });

    test("null and undefined entries are skipped between live sources", () => {
      const target = new AbortController();
      const a = new AbortController();
      const b = new AbortController();
      relay([null, a.signal, undefined, b.signal], target);

      const reasonB = new Error("B");
      b.abort(reasonB);
      assert(target.signal.aborted);
      assertStrictEquals(target.signal.reason, reasonB);
    });
  });
});

/** Waits `ms` on a real timer. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("abort.TimeoutWheel", () => {
  describe("firing", () => {
    test("aborts at the deadline with the memoized TimeoutError", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      const handle = wheel.schedule(controller, 5);

      assert(!controller.signal.aborted);
      await sleep(30);

      assert(controller.signal.aborted);
      assertIsError(controller.signal.reason, DOMException, "Signal timed out.");
      assertEquals(controller.signal.reason.name, "TimeoutError");
      // The request path classifies timeouts by reference (`error === timeout.reason`): the
      // abort reason and the handle's reason must be one object, memoized across reads.
      assertStrictEquals(controller.signal.reason, handle.reason);
      assertStrictEquals(handle.reason, handle.reason);
    });

    test("never aborts before the deadline", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      wheel.schedule(controller, 40);

      await sleep(15);
      assert(!controller.signal.aborted);
      await sleep(60);
      assert(controller.signal.aborted);
    });

    test("same-deadline entries fire in insertion order", async () => {
      const wheel = new TimeoutWheel();
      const order: number[] = [];
      for (let i = 0; i < 3; i++) {
        const controller = new AbortController();
        controller.signal.addEventListener("abort", () => order.push(i));
        wheel.schedule(controller, 5);
      }

      await sleep(30);
      assertEquals(order, [0, 1, 2]);
    });

    test("later deadlines fire later, regardless of schedule order", async () => {
      const wheel = new TimeoutWheel();
      const order: string[] = [];
      const slow = new AbortController();
      slow.signal.addEventListener("abort", () => order.push("slow"));
      const fast = new AbortController();
      fast.signal.addEventListener("abort", () => order.push("fast"));

      wheel.schedule(slow, 50);
      wheel.schedule(fast, 5); // earlier than the armed timer: must re-arm
      await sleep(90);
      assertEquals(order, ["fast", "slow"]);
    });

    test("timeout: 0 fires on a later turn, through the overdue path", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      wheel.schedule(controller, 0);

      assert(!controller.signal.aborted); // never synchronously
      await sleep(20); // the timer wakes up at >= 1 ms with the deadline already in the past
      assert(controller.signal.aborted);
    });

    test("an entry due while the loop was busy fires on the late wake-up", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      wheel.schedule(controller, 5);

      // Block the event loop past the deadline: the wake-up arrives ~25 ms late and the
      // deadline check — not the wake-up — must decide that the entry fires.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      await sleep(10);
      assert(controller.signal.aborted);
    });

    test("a delay beyond 2^31-1 ms fires almost immediately, like the native clamp", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      wheel.schedule(controller, 3_000_000_000); // native setTimeout clamps this to ~1 ms

      await sleep(30);
      assert(controller.signal.aborted);
    });
  });

  describe("disabled and cancelled timeouts", () => {
    test("null disables the timeout: no entry, no timer", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      const handle = wheel.schedule(controller, null);

      await sleep(20);
      assert(!controller.signal.aborted);
      handle.cancel(); // must not throw
      // The lazy reason still exists for reference classification, without any abort.
      assertEquals(handle.reason.name, "TimeoutError");
    });

    test("non-finite values are disabled too", async () => {
      const wheel = new TimeoutWheel();
      const a = new AbortController();
      const b = new AbortController();
      wheel.schedule(a, Number.POSITIVE_INFINITY);
      wheel.schedule(b, Number.NaN);

      await sleep(20);
      assert(!a.signal.aborted);
      assert(!b.signal.aborted);
    });

    test("cancel before the deadline prevents the abort", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      const handle = wheel.schedule(controller, 5);
      handle.cancel();

      await sleep(30);
      assert(!controller.signal.aborted);
    });

    test("double cancel is a no-op", async () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      const handle = wheel.schedule(controller, 5);
      handle.cancel();
      handle.cancel();

      await sleep(20);
      assert(!controller.signal.aborted);
    });

    test("cancelling a mid-queue entry keeps the head enforced", async () => {
      const wheel = new TimeoutWheel();
      const head = new AbortController();
      const tail = new AbortController();
      wheel.schedule(head, 5);
      wheel.schedule(tail, 5_000).cancel(); // mid-queue: the head must still fire on time

      await sleep(30);
      assert(head.signal.aborted);
      assert(!tail.signal.aborted);
    });

    test("cancelling the head keeps later entries enforced at their own deadlines", async () => {
      const wheel = new TimeoutWheel();
      const head = new AbortController();
      const tail = new AbortController();
      wheel.schedule(head, 5).cancel();
      wheel.schedule(tail, 40);

      await sleep(20);
      assert(!head.signal.aborted);
      assert(!tail.signal.aborted); // re-armed for the new head, not stuck on the old deadline
      await sleep(50);
      assert(!head.signal.aborted);
      assert(tail.signal.aborted);
    });

    test("scheduling from an abort listener keeps the wheel consistent", async () => {
      const wheel = new TimeoutWheel();
      const a = new AbortController();
      const b = new AbortController();
      a.signal.addEventListener("abort", () => wheel.schedule(b, 40)); // re-enters mid-callback
      wheel.schedule(a, 5);

      await sleep(25);
      assert(a.signal.aborted);
      assert(!b.signal.aborted); // b's 40 ms started when a fired, ~5 ms in
      await sleep(60);
      assert(b.signal.aborted);
    });
  });

  describe("the shared native timer", () => {
    /** Installs a counting `setTimeout` spy; returns the call delays and a restore function. */
    function spyOnSetTimeout(): { delays: (number | undefined)[]; restore: () => void } {
      const original = globalThis.setTimeout;
      const delays: (number | undefined)[] = [];
      globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
        delays.push(args[1]);
        return original(...args);
      }) as typeof setTimeout;
      return { delays, restore: () => (globalThis.setTimeout = original) };
    }

    test("sequential timeouts ride one armed timer", async () => {
      const spy = spyOnSetTimeout();
      try {
        const wheel = new TimeoutWheel();
        const a = new AbortController();
        wheel.schedule(a, 25).cancel(); // queue drains: the armed timer is left stale
        assertEquals(spy.delays.length, 1);

        const b = new AbortController();
        wheel.schedule(b, 25); // covered by the stale timer: no second native timer
        assertEquals(spy.delays.length, 1);

        await sleep(70); // the stale timer fires early, re-arms, and serves b at its deadline
        assert(!a.signal.aborted);
        assert(b.signal.aborted);
      } finally {
        spy.restore();
      }
    });

    test("an earlier-deadline entry re-arms the timer", async () => {
      const spy = spyOnSetTimeout();
      try {
        const wheel = new TimeoutWheel();
        const slow = new AbortController();
        wheel.schedule(slow, 5_000);
        assertEquals(spy.delays.length, 1);

        const fast = new AbortController();
        wheel.schedule(fast, 5);
        assertEquals(spy.delays.length, 2); // clear + re-arm for the new head

        await sleep(30);
        assert(fast.signal.aborted);
        assert(!slow.signal.aborted);
      } finally {
        spy.restore();
      }
    });

    test("the armed timer is unref'd where the platform supports it", async () => {
      const original = globalThis.setTimeout;
      let armed: ReturnType<typeof setTimeout> | undefined;
      globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
        armed = original(...args);
        return armed;
      }) as typeof setTimeout;
      try {
        const wheel = new TimeoutWheel();
        const controller = new AbortController();
        wheel.schedule(controller, 5);

        // Bun/Node expose hasRef(); where the platform lacks ref semantics there is
        // nothing to assert (the wheel guards the unref call the same way).
        const hasRef = (armed as { hasRef?: () => boolean } | undefined)?.hasRef;
        if (typeof hasRef === "function") assertEquals(hasRef.call(armed), false);

        await sleep(20); // let the timer fire so nothing lingers past the test
        assert(controller.signal.aborted);
      } finally {
        globalThis.setTimeout = original;
      }
    });
  });

  describe("fake time", () => {
    // The wheel reads Date.now() for deadlines and arms plain setTimeout/clearTimeout — the
    // pair FakeTime patches together — so tick-driven tests behave exactly like real ones.
    let time: FakeTime;
    beforeEach(() => {
      time = new FakeTime();
    });
    afterEach(() => {
      time.restore();
    });

    test("deadlines track the patched clock", () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      wheel.schedule(controller, 5);

      time.tick(4);
      assert(!controller.signal.aborted);
      time.tick(1);
      assert(controller.signal.aborted);
      assertEquals(controller.signal.reason.name, "TimeoutError");
    });

    test("a not-yet-due entry survives an early wake-up and is re-armed", () => {
      const wheel = new TimeoutWheel();
      const early = new AbortController();
      const late = new AbortController();
      wheel.schedule(early, 5);
      wheel.schedule(late, 100);

      time.tick(5); // the shared timer fires for `early`; `late` is not due
      assert(early.signal.aborted);
      assert(!late.signal.aborted);

      time.tick(95); // the re-armed timer serves `late` at its own deadline
      assert(late.signal.aborted);
    });

    test("cancel under fake time still prevents the abort", () => {
      const wheel = new TimeoutWheel();
      const controller = new AbortController();
      wheel.schedule(controller, 5).cancel();

      time.tick(1_000);
      assert(!controller.signal.aborted);
    });
  });
});
