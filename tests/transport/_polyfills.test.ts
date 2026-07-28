/**
 * Tests for the platform shims: the native pass-throughs used on Node/Bun/browser, and the
 * fallback implementations selected on platforms missing the API (mainly React Native).
 *
 * The fallbacks for DOMException/CustomEvent are chosen once at module evaluation, so covering
 * them takes a fresh module instance: the platform globals are deleted and the module is
 * re-imported through a cache-busting query string (`_polyfills.ts?…`), which Bun treats as a
 * distinct module record. `Promise_.withResolvers` dispatches at call time, so its fallback can
 * be exercised on the primary module by temporarily deleting `Promise.withResolvers`.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { CustomEvent_, DOMException_, Promise_ } from "../../src/transport/_polyfills.ts";

describe("platform shims on a full platform", () => {
  test("Promise_.withResolvers() delegates to the native Promise.withResolvers", async () => {
    const { promise, resolve, reject } = Promise_.withResolvers<number>();
    resolve(42);
    expect(await promise).toBe(42);
    expect(typeof reject).toBe("function");
  });

  test("Promise_.withResolvers() exposes a working reject", async () => {
    const { promise, reject } = Promise_.withResolvers<number>();
    reject(new Error("nope"));
    await expect(promise).rejects.toThrow("nope");
  });

  test("Promise_.withResolvers() falls back when Promise.withResolvers is missing", async () => {
    const original = Promise.withResolvers;
    delete (Promise as unknown as Record<string, unknown>).withResolvers;
    try {
      const { promise, resolve, reject } = Promise_.withResolvers<number>();
      expect(typeof reject).toBe("function");
      resolve(7);
      expect(await promise).toBe(7);
    } finally {
      Promise.withResolvers = original;
    }
  });

  test("DOMException_ and CustomEvent_ are the native classes", () => {
    expect(DOMException_).toBe(globalThis.DOMException);
    expect(CustomEvent_).toBe(globalThis.CustomEvent);
  });
});

describe("platform shims on a platform missing the APIs (React Native)", () => {
  test("falls back to the bundled implementations", async () => {
    const originalWithResolvers = Promise.withResolvers;
    const originalDOMException = globalThis.DOMException;
    const originalCustomEvent = globalThis.CustomEvent;
    delete (Promise as unknown as Record<string, unknown>).withResolvers;
    delete (globalThis as Record<string, unknown>).DOMException;
    delete (globalThis as Record<string, unknown>).CustomEvent;
    try {
      // A fresh module instance: the IIFEs re-run and now select the fallback shims. The
      // cache-busting query goes through a variable so tsc does not try to resolve it.
      const shimmedSpecifier = "../../src/transport/_polyfills.ts?react-native";
      const shimmed: typeof import("../../src/transport/_polyfills.ts") = await import(shimmedSpecifier);
      expect(shimmed.Promise_).not.toBe(Promise_);

      // Promise.withResolvers fallback: manual resolver wiring.
      const { promise, resolve, reject } = shimmed.Promise_.withResolvers<number>();
      expect(promise).toBeInstanceOf(Promise);
      resolve(7);
      expect(await promise).toBe(7);
      const rejected = shimmed.Promise_.withResolvers<number>();
      rejected.reject(new Error("fallback"));
      await expect(rejected.promise).rejects.toThrow("fallback");

      // DOMException fallback: an Error subclass carrying the name.
      const exception = new shimmed.DOMException_("boom", "AbortError");
      expect(exception).toBeInstanceOf(Error);
      expect(exception.message).toBe("boom");
      expect(exception.name).toBe("AbortError");
      // Constructor defaults: empty message, "Error" name.
      expect(new shimmed.DOMException_().name).toBe("Error");

      // CustomEvent fallback: an Event subclass carrying the detail.
      const event = new shimmed.CustomEvent_("ping", { detail: { a: 1 } });
      expect(event).toBeInstanceOf(Event);
      expect(event.type).toBe("ping");
      expect(event.detail).toEqual({ a: 1 });
      expect(new shimmed.CustomEvent_("ping").detail).toBeNull();
      // The deprecated initCustomEvent is a no-op kept for interface parity (the union with the
      // native class types it as requiring arguments, so call it through the fallback's shape).
      (event as unknown as { initCustomEvent(): void }).initCustomEvent();
    } finally {
      Promise.withResolvers = originalWithResolvers;
      globalThis.DOMException = originalDOMException;
      globalThis.CustomEvent = originalCustomEvent;
    }
    expect(typeof Promise.withResolvers).toBe("function");
  });
});
