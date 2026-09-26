/**
 * Tests for {@linkcode isAbortSignal}: the structural AbortSignal check shared by every API layer
 * for `params | signal` overload disambiguation, and its re-export through the Info base module.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { isAbortSignal } from "../../../src/_base.ts";
import { isAbortSignal as infoIsAbortSignal } from "../../../src/api/info/_methods/_base/_signal.ts";

describe("isAbortSignal", () => {
  test("the Info base module re-exports the shared implementation", () => {
    expect(infoIsAbortSignal).toBe(isAbortSignal);
  });

  test("accepts a native AbortSignal", () => {
    expect(isAbortSignal(new AbortController().signal)).toBe(true);
  });

  test("accepts a duck-typed signal from another realm or a polyfill", () => {
    // `instanceof AbortSignal` fails across realms (iframe, worker, vm) and for polyfills;
    // the structural check must accept any signal-like object.
    const fakeSignal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
    expect(isAbortSignal(fakeSignal)).toBe(true);
  });

  test("rejects params-like objects, null, and non-objects", () => {
    expect(isAbortSignal({})).toBe(false);
    expect(isAbortSignal({ aborted: false })).toBe(false);
    expect(isAbortSignal({ addEventListener: () => {} })).toBe(false);
    expect(isAbortSignal(null)).toBe(false);
    expect(isAbortSignal(undefined)).toBe(false);
    expect(isAbortSignal("signal")).toBe(false);
  });
});
