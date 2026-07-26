/**
 * Characterization tests for the identity-formation utilities used to match
 * WebSocket requests with their server echoes.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@jsr/std__assert";
import { isSubset, requestToId, specificity } from "../../../src/transport/websocket/_id.ts";

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
