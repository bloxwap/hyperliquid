/**
 * Tests for the abort wiring helpers, focused on the multi-source relay's manual
 * listener bookkeeping: listeners are added with `once: true` and removed by a
 * detach loop, an already-aborted source fires immediately, and spent/null
 * sources are skipped.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertStrictEquals } from "@jsr/std__assert";
import { relay } from "../../src/transport/_abort.ts";

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
