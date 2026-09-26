/**
 * Offline tests for the shared decimal schemas: exponent notation (from number inputs such as
 * `1e-8`, whose `String()` form is `"1e-8"`, or from string inputs) is expanded to plain decimal
 * digits — matching the Python SDK's `float_to_wire` — while non-finite values stay rejected.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import * as v from "valibot";

import { Decimal, UnsignedDecimal, cloidFromInt } from "../../src/api/_schemas.ts";
import { HyperliquidError } from "../../src/_base.ts";
// The public surface: cloidFromInt is re-exported from the exchange API module.
import { cloidFromInt as cloidFromIntPublic } from "@bloxwap/hyperliquid/api/exchange";

describe("UnsignedDecimal", () => {
  test("expands exponent notation from number inputs", () => {
    assertEquals(v.parse(UnsignedDecimal, 1e-8), "0.00000001");
    assertEquals(v.parse(UnsignedDecimal, 1.23e-7), "0.000000123");
    assertEquals(v.parse(UnsignedDecimal, 1.5e3), "1500");
    assertEquals(v.parse(UnsignedDecimal, 1e20), "100000000000000000000");
    assertEquals(v.parse(UnsignedDecimal, 1e21), "1000000000000000000000");
  });

  test("expands exponent notation from string inputs", () => {
    assertEquals(v.parse(UnsignedDecimal, "1e-8"), "0.00000001");
    assertEquals(v.parse(UnsignedDecimal, "1.23e-7"), "0.000000123");
    assertEquals(v.parse(UnsignedDecimal, "1.5e+3"), "1500");
    assertEquals(v.parse(UnsignedDecimal, "2E4"), "20000");
  });

  test("still normalizes plain decimals", () => {
    assertEquals(v.parse(UnsignedDecimal, "00123"), "123");
    assertEquals(v.parse(UnsignedDecimal, "1.2000"), "1.2");
    assertEquals(v.parse(UnsignedDecimal, ".5"), "0.5");
    assertEquals(v.parse(UnsignedDecimal, 0.1), "0.1");
  });

  test("rejects non-finite values", () => {
    assertEquals(v.safeParse(UnsignedDecimal, Number.NaN).success, false);
    assertEquals(v.safeParse(UnsignedDecimal, Number.POSITIVE_INFINITY).success, false);
    assertEquals(v.safeParse(UnsignedDecimal, Number.NEGATIVE_INFINITY).success, false);
    assertEquals(v.safeParse(UnsignedDecimal, "NaN").success, false);
    assertEquals(v.safeParse(UnsignedDecimal, "Infinity").success, false);
  });

  test("rejects negative values, including exponent notation", () => {
    assertEquals(v.safeParse(UnsignedDecimal, -1).success, false);
    assertEquals(v.safeParse(UnsignedDecimal, "-1e-3").success, false);
  });
});

describe("Decimal", () => {
  test("expands exponent notation preserving the sign", () => {
    assertEquals(v.parse(Decimal, -1e-8), "-0.00000001");
    assertEquals(v.parse(Decimal, "-1.5e+3"), "-1500");
    assertEquals(v.parse(Decimal, "-0e0"), "0");
    assertEquals(v.parse(Decimal, "-0.0"), "0");
  });

  test("rejects non-finite values", () => {
    assertEquals(v.safeParse(Decimal, Number.NaN).success, false);
    assertEquals(v.safeParse(Decimal, Number.POSITIVE_INFINITY).success, false);
    assertEquals(v.safeParse(Decimal, Number.NEGATIVE_INFINITY).success, false);
  });
});

describe("cloidFromInt", () => {
  test("is re-exported from the public exchange module", () => {
    assertEquals(cloidFromIntPublic, cloidFromInt);
  });

  test("matches Python's Cloid.from_int format (0x + 32 lowercase hex, zero-padded)", () => {
    assertEquals(cloidFromInt(1), "0x00000000000000000000000000000001");
    assertEquals(cloidFromInt(255), "0x000000000000000000000000000000ff");
    assertEquals(cloidFromInt(0xdeadbeef), "0x000000000000000000000000deadbeef");
    assertEquals(cloidFromInt(12345678901234567890n), "0x0000000000000000ab54a98ceb1f0ad2");
  });

  test("boundary values", () => {
    assertEquals(cloidFromInt(0), "0x00000000000000000000000000000000");
    assertEquals(cloidFromInt(0n), "0x00000000000000000000000000000000");
    assertEquals(cloidFromInt(2n ** 128n - 1n), "0xffffffffffffffffffffffffffffffff");
  });

  test("number and bigint forms agree", () => {
    assertEquals(cloidFromInt(42), cloidFromInt(42n));
    assertEquals(cloidFromInt(2 ** 53 - 1), cloidFromInt(9007199254740991n));
  });

  test("rejects out-of-range and negative integers", () => {
    assertThrows(() => cloidFromInt(2n ** 128n), HyperliquidError);
    assertThrows(() => cloidFromInt(-1), HyperliquidError);
    assertThrows(() => cloidFromInt(-1n), HyperliquidError);
  });

  test("rejects numbers that are not safe integers", () => {
    assertThrows(() => cloidFromInt(1.5), HyperliquidError);
    assertThrows(() => cloidFromInt(2 ** 53), HyperliquidError);
    assertThrows(() => cloidFromInt(Number.NaN), HyperliquidError);
    assertThrows(() => cloidFromInt(Number.POSITIVE_INFINITY), HyperliquidError);
  });
});
