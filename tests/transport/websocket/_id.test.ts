/**
 * Characterization tests for the identity-formation utilities used to match
 * WebSocket requests with their server echoes.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@jsr/std__assert";
import { isSubset, normalize, requestToId, specificity } from "../../../src/transport/websocket/_id.ts";

describe("requestToId", () => {
  test("sorts object keys recursively", () => {
    assertEquals(requestToId({ b: 1, a: { d: 2, c: 3 } }), requestToId({ a: { c: 3, d: 2 }, b: 1 }));
  });

  test("lowercases hex strings, including nested ones", () => {
    assertEquals(requestToId({ user: "0xABCDEF", list: ["0x0A"] }), requestToId({ user: "0xabcdef", list: ["0x0a"] }));
  });

  test("treats non-hex strings as case-sensitive", () => {
    assert(requestToId({ coin: "ETH" }) !== requestToId({ coin: "eth" }));
  });

  test("keeps array order significant", () => {
    assert(requestToId([1, 2]) !== requestToId([2, 1]));
  });

  test("keeps an own __proto__ key from a parsed payload", () => {
    const payload = JSON.parse('{"type":"l2Book","__proto__":{"coin":"BTC"}}') as Record<string, unknown>;
    assertEquals(requestToId(payload), '{"__proto__":{"coin":"BTC"},"type":"l2Book"}');
  });

  test("payloads differing only in __proto__ get different ids", () => {
    const withProto = JSON.parse('{"a":1,"__proto__":2}');
    const withoutProto = JSON.parse('{"a":1}');
    assert(requestToId(withProto) !== requestToId(withoutProto));
  });

  test("normalizing a __proto__ payload does not pollute plain objects", () => {
    requestToId(JSON.parse('{"__proto__":{"polluted":true}}'));
    assertFalse("polluted" in {});
  });
});

describe("normalize", () => {
  test("keeps an own __proto__ key as an own key", () => {
    const payload = JSON.parse('{"b":1,"__proto__":{"x":2},"a":3}') as Record<string, unknown>;
    const normalized = normalize(payload) as Record<string, unknown>;

    assertEquals(Object.keys(normalized), ["__proto__", "a", "b"]);
    const protoEntry = Object.getOwnPropertyDescriptor(normalized, "__proto__");
    assertEquals(protoEntry?.enumerable, true);
    assertEquals(((protoEntry?.value ?? {}) as Record<string, unknown>).x, 2);
  });

  test("output for ordinary inputs is byte-identical to a plain-object build", () => {
    const input = { z: { b: 1, a: [2, { d: 4, c: 3 }] }, a: "0xABC" };
    assertEquals(JSON.stringify(normalize(input)), '{"a":"0xabc","z":{"a":[2,{"c":3,"d":4}],"b":1}}');
  });
});

describe("isSubset", () => {
  test("accepts extra fields in the superset", () => {
    assert(isSubset({ a: 1 }, { a: 1, b: 2 }));
  });

  test("rejects missing or different values", () => {
    assertFalse(isSubset({ a: 1 }, { b: 2 }));
    assertFalse(isSubset({ a: 1 }, { a: 2 }));
  });

  test("compares hex strings case-insensitively", () => {
    assert(isSubset({ user: "0xAB" }, { user: "0xab" }));
  });

  test("requires equal array lengths with per-element subsets", () => {
    assert(isSubset([{ a: 1 }], [{ a: 1, b: 2 }]));
    assertFalse(isSubset([1], [1, 2]));
  });
});

describe("specificity", () => {
  test("counts leaf values recursively", () => {
    assertEquals(specificity({ a: 1, b: { c: 2, d: [3, 4] } }), 4);
  });

  test("a primitive counts as one leaf", () => {
    assertEquals(specificity("x"), 1);
    assertEquals(specificity(null), 1);
  });

  test("a strict superset is more specific than its subset", () => {
    const subset = { type: "l2Book", coin: "BTC" };
    const superset = { type: "l2Book", coin: "BTC", nSigFigs: 5 };
    assert(specificity(superset) > specificity(subset));
  });
});
