/**
 * Offline tests for the shared decimal schemas: exponent notation (from number inputs such as
 * `1e-8`, whose `String()` form is `"1e-8"`, or from string inputs) is expanded to plain decimal
 * digits — matching the Python SDK's `float_to_wire` — while non-finite values stay rejected.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import * as v from "valibot";

import { Decimal, UnsignedDecimal } from "../../src/api/_schemas.ts";

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
