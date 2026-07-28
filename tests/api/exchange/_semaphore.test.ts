/**
 * Tests for the internal per-key lock helper: mutual exclusion, FIFO wake-up order,
 * release-on-throw, and registry cleanup once a key's reference count reaches zero
 * (gh issue #35).
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@jsr/std__assert";

import { withLock } from "../../../src/api/exchange/_methods/_base/_semaphore.ts";

// ============================================================
// Helpers
// ============================================================

/** A one-shot gate: `fn` bodies await `gate.promise` until `gate.open()` is called. */
function createGate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

/** Yields to the macrotask queue so any runnable waiter would have had its chance to run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================
// Tests
// ============================================================

describe("withLock", () => {
  test("overlapping calls on the same key are mutually exclusive", async () => {
    const events: string[] = [];
    const gate = createGate();

    const first = withLock("key", async () => {
      events.push("first:enter");
      await gate.promise;
      events.push("first:exit");
    });
    const second = withLock("key", async () => {
      events.push("second:enter");
    });

    // While the first call holds the lock, the second must not enter its body.
    await flush();
    assertEquals(events, ["first:enter"]);

    gate.open();
    await Promise.all([first, second]);
    assertEquals(events, ["first:enter", "first:exit", "second:enter"]);
  });

  test("calls on different keys do not block each other", async () => {
    const gate = createGate();

    const first = withLock("key-a", () => gate.promise);
    const second = withLock("key-b", () => Promise.resolve("ran"));

    // `key-b` is uncontended, so it must complete even though `key-a` is still held.
    assertEquals(await second, "ran");
    gate.open();
    await first;
  });

  test("queued waiters are woken in FIFO order", async () => {
    const order: number[] = [];
    const gate = createGate();

    // The holder parks on the gate; the waiters queue up behind it in call order.
    const holder = withLock("key", async () => {
      await gate.promise;
      order.push(0);
    });
    const waiters = [1, 2, 3].map((i) =>
      withLock("key", async () => {
        order.push(i);
      }),
    );

    gate.open();
    await Promise.all([holder, ...waiters]);
    assertEquals(order, [0, 1, 2, 3]);
  });

  test("the lock is released when fn throws", async () => {
    await assertRejects(() => withLock("key", () => Promise.reject(new Error("boom"))), Error, "boom");

    // A failure must not poison the key: the next caller acquires and returns normally.
    const result = await withLock("key", () => Promise.resolve("ok"));
    assertEquals(result, "ok");
  });

  test("a fully unreferenced key behaves like a never-seen key on next use", async () => {
    // One complete ref/unref cycle: on completion the registry drops the entry.
    await withLock("key", () => Promise.resolve());

    // Re-referencing the key must yield a fresh, uncontended lock: this call resolves
    // immediately, without anything from the previous lifecycle releasing it.
    const result = await withLock("key", () => Promise.resolve("fresh"));
    assertEquals(result, "fresh");

    // And the fresh lock still serializes an overlapping pair correctly.
    const events: string[] = [];
    const gate = createGate();
    const first = withLock("key", async () => {
      events.push("first");
      await gate.promise;
    });
    const second = withLock("key", async () => {
      events.push("second");
    });
    await flush();
    assertEquals(events, ["first"], "a recycled key must still enforce mutual exclusion");
    gate.open();
    await Promise.all([first, second]);
    assert(events.length === 2);
  });

  test("a long waiter queue compacts without dropping FIFO order", async () => {
    // Drive head past 16 so release() slices the dead prefix off the waiters array.
    const order: number[] = [];
    const gate = createGate();
    const holder = withLock("compact-key", async () => {
      await gate.promise;
      order.push(0);
    });
    const waiters = Array.from({ length: 20 }, (_, i) =>
      withLock("compact-key", async () => {
        order.push(i + 1);
      }),
    );
    await flush();
    gate.open();
    await Promise.all([holder, ...waiters]);
    assertEquals(
      order,
      Array.from({ length: 21 }, (_, i) => i),
    );
  });
});
