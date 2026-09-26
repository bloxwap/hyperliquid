// deno-lint-ignore-file no-explicit-any

/**
 * Runtime shims for APIs missing on some supported platforms, mainly React Native.
 * @module
 */

/** Fallback for {@link Promise.withResolvers} on platforms that lack it. */
function withResolversFallback<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise */
export const Promise_ = {
  /** @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers */
  withResolvers: <T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  } => {
    // Call-time dispatch so deleting `Promise.withResolvers` in tests exercises the fallback
    // on the same module instance.
    return typeof Promise.withResolvers === "function" ? Promise.withResolvers<T>() : withResolversFallback<T>();
  },
};

/** @see https://developer.mozilla.org/en-US/docs/Web/API/DOMException */
export const DOMException_ = /* @__PURE__ */ (() => {
  return (
    globalThis.DOMException ||
    class DOMException extends Error {
      constructor(message = "", name = "Error") {
        super(message);
        this.name = name;
      }
    }
  );
})();

/** @see https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent */
export const CustomEvent_ = /* @__PURE__ */ (() => {
  return (
    globalThis.CustomEvent ||
    class CustomEvent<T> extends Event {
      readonly detail: T | null;
      constructor(type: string, eventInitDict?: CustomEventInit<T>) {
        super(type, eventInitDict);
        this.detail = eventInitDict?.detail ?? null;
      }
      initCustomEvent(): void {
        // Deprecated DOM API stub; kept for interface parity with native CustomEvent.
        return;
      }
    }
  );
})();
