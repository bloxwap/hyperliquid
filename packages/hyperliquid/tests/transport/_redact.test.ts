/**
 * Tests for the recursive signature redactor: arbitrarily deep nesting, reference
 * cycles, shared (diamond) references, and the by-reference fast path.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals } from "@jsr/std__assert";
import { HttpRequestError } from "@bloxwap/hyperliquid";
import { redactSignature } from "../../src/transport/_redact.ts";

/** Wraps `value` in `depth` levels of singly-nested objects. */
function nest(value: unknown, depth: number): Record<string, unknown> {
  let current: unknown = value;
  for (let i = 0; i < depth; i++) current = { inner: current };
  return current as Record<string, unknown>;
}

const SIGNATURE = { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 };

describe("redactSignature", () => {
  test("redacts a signature 20 levels deep", () => {
    const payload = nest({ action: { type: "order" }, signature: SIGNATURE, nonce: 1 }, 20);

    const serialized = JSON.stringify(redactSignature(payload));
    assert(!serialized.includes("1".repeat(64)), "signature hex leaked at depth 20");
    assert(serialized.includes('"signature":"0x<redacted>"'));
    assert(serialized.includes('"type":"order"')); // action content remains
  });

  test("redacts a signatures array 12 levels deep, keeping its length", () => {
    const payload = nest({ signatures: [SIGNATURE, SIGNATURE] }, 12);

    const serialized = JSON.stringify(redactSignature(payload));
    assert(!serialized.includes("1".repeat(64)), "signatures hex leaked at depth 12");
    assert(serialized.includes('"signatures":["0x<redacted>","0x<redacted>"]'));
  });

  test("a reference cycle is replaced with a marker: nothing leaks, the copy stays serializable", () => {
    interface Circular {
      name: string;
      signature: typeof SIGNATURE;
      self?: unknown;
    }
    const circular: Circular = { name: "loop", signature: SIGNATURE };
    circular.self = circular;

    const redacted = redactSignature({ payload: circular });
    const serialized = JSON.stringify(redacted); // must not throw
    assert(!serialized.includes("1".repeat(64)), "signature hex leaked through a cycle");
    assert(serialized.includes('"signature":"0x<redacted>"'));
    assert(serialized.includes("[Circular]"));
  });

  test("shared (diamond) references are not mistaken for cycles", () => {
    const shared = { signature: SIGNATURE };

    const serialized = JSON.stringify(redactSignature({ first: shared, second: shared }));
    assert(!serialized.includes("1".repeat(64)), "signature hex leaked through a shared reference");
    assert(!serialized.includes("[Circular]"));
  });

  test("payloads without a signature pass through by reference", () => {
    const payload = { type: "allMids", nested: { deep: [1, 2, 3] } };
    assert(redactSignature(payload) === payload);
    assert(redactSignature(null) === null);
    assert(redactSignature(undefined) === undefined);
    assert(redactSignature("signature") === "signature");
  });

  test("the original object is never mutated", () => {
    const payload = { action: { signatures: [SIGNATURE] }, signature: SIGNATURE };
    redactSignature(payload);
    assertEquals(payload.signature, SIGNATURE);
    assertEquals(payload.action.signatures[0], SIGNATURE);
  });

  test("redacts a signature 50_000 levels deep without recursion", () => {
    let payload: Record<string, unknown> = { action: { type: "order" }, signature: SIGNATURE, nonce: 1 };
    for (let i = 0; i < 50_000; i++) payload = { inner: payload };

    const redacted = redactSignature(payload); // must not throw (no call-stack recursion)

    // Walk the result iteratively down to the innermost object: the signature is redacted.
    let node = redacted as Record<string, unknown>;
    while (!("signature" in node)) node = node.inner as Record<string, unknown>;
    assertEquals(node.signature, "0x<redacted>");
    assertEquals(node.action, { type: "order" });
    assert(redacted !== payload, "the redacted deep structure must be a copy");
  });

  test("error construction is never masked by a deep payload", () => {
    let payload: Record<string, unknown> = { signature: SIGNATURE };
    for (let i = 0; i < 50_000; i++) payload = { inner: payload };

    // JSON.stringify itself throws on this depth in Bun; the error wrapping that failure must
    // still construct cleanly.
    const error = new HttpRequestError({ detail: "Converting circular structure to JSON", request: payload });
    let node = error.request as Record<string, unknown>;
    while (!("signature" in node)) node = node.inner as Record<string, unknown>;
    assertEquals(node.signature, "0x<redacted>");
  });

  test("a cycle deep in the structure is marked, not looped on", () => {
    interface Deep {
      inner?: unknown;
      signature?: unknown;
    }
    const root: Deep = { signature: SIGNATURE };
    let tip = root;
    for (let i = 0; i < 100; i++) tip = tip.inner = {} as Deep;
    tip.inner = root; // close the cycle at depth 100

    const serialized = JSON.stringify(redactSignature({ payload: root }));
    assert(serialized.includes("[Circular]"));
    assert(serialized.includes('"signature":"0x<redacted>"'));
    assert(!serialized.includes("1".repeat(64)));
  });

  test("toJSON output is what gets redacted (top level)", () => {
    const payload = {
      toJSON() {
        return { action: { type: "order" }, signature: SIGNATURE, nonce: 1 };
      },
    };

    const redacted = redactSignature(payload);
    const serialized = JSON.stringify(redacted);
    assert(!serialized.includes("1".repeat(64)), "secrets emitted through toJSON leaked");
    assert(serialized.includes('"signature":"0x<redacted>"'));
    assert(serialized.includes('"type":"order"'));
    assert(redacted !== payload, "a toJSON-bearing object must never pass through by reference");
  });

  test("toJSON is invoked with the key the object sits under", () => {
    let seenKey: string | undefined;
    const payload = {
      a: {
        b: {
          c: {
            toJSON(key: string) {
              seenKey = key;
              return { signature: SIGNATURE };
            },
          },
        },
      },
    };

    const serialized = JSON.stringify(redactSignature(payload));
    assertEquals(seenKey, "c");
    assert(!serialized.includes("1".repeat(64)));
    assert(serialized.includes('"signature":"0x<redacted>"'));
  });

  test("toJSON returning a cyclical structure terminates as [Circular]", () => {
    const cyclical: Record<string, unknown> = { name: "loop" };
    cyclical.self = cyclical;
    const payload = {
      toJSON() {
        return cyclical;
      },
    };

    const serialized = JSON.stringify(redactSignature(payload)); // must not throw or hang
    assert(serialized.includes("[Circular]"));
  });

  test("toJSON returning its own owner closes a cycle immediately", () => {
    // The serialized form IS the object being walked: without the owner on the path before
    // `toJSON` runs, the walk would descend into the same node forever.
    const payload = {
      signature: SIGNATURE,
      wrapper: {
        toJSON() {
          return this;
        },
      },
    };

    const redacted = redactSignature(payload) as Record<string, unknown>;
    assertEquals(redacted.wrapper, "[Circular]");
    const serialized = JSON.stringify(redacted); // must not throw or hang
    assert(serialized.includes('"signature":"0x<redacted>"'));
  });

  test("toJSON returning an ancestor closes a cycle immediately", () => {
    const root: Record<string, unknown> = { name: "root" };
    root.child = {
      toJSON() {
        return root;
      },
    };

    const redacted = redactSignature({ payload: root }) as Record<string, unknown>;
    assertEquals((redacted.payload as Record<string, unknown>).child, "[Circular]");
  });

  test("toJSON plus an own signature key: the serialized form wins", () => {
    const real = { r: `0x${"9".repeat(64)}`, s: `0x${"8".repeat(64)}`, v: 27 };
    const payload = {
      signature: real, // invisible to JSON.stringify once toJSON exists
      toJSON() {
        return { action: { type: "order" } };
      },
    };

    const redacted = redactSignature(payload) as Record<string, unknown>;
    // JSON.stringify(payload) would emit the toJSON output, so that output is the redaction result.
    assertEquals(redacted, { action: { type: "order" } });
    assert(!JSON.stringify(redacted).includes("9".repeat(64)));
  });

  test("a throwing toJSON never masks the error being constructed", () => {
    const payload = {
      toJSON() {
        throw new Error("serializer exploded");
      },
    };

    const redacted = redactSignature(payload) as unknown;
    assertEquals(redacted, "[Unserializable]");
    const error = new HttpRequestError({ detail: "x", request: payload });
    assertEquals(error.request, "[Unserializable]");
  });
});
