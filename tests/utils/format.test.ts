/**
 * Tests for the price/size formatters: significant-figure caps, decimal limits
 * per market type, normalization, and the documented reference values.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { Decimal } from "decimal.js";
import { FormatError, formatPrice, formatSize } from "@bloxwap/hyperliquid/utils";

// ============================================================
// Test Data
// ============================================================

const REFERENCE_PERPS = [
  { asset: "PURR", szDecimals: 0, minPrice: "0.0001", minSize: "1" },
  { asset: "DYDX", szDecimals: 1, minPrice: "0.00001", minSize: "0.1" },
  { asset: "SOL", szDecimals: 2, minPrice: "0.01", minSize: "0.01" },
  { asset: "BNB", szDecimals: 3, minPrice: "0.1", minSize: "0.001" },
  { asset: "ETH", szDecimals: 4, minPrice: "0.1", minSize: "0.0001" },
  { asset: "BTC", szDecimals: 5, minPrice: "1", minSize: "0.00001" },
] as const;

const REFERENCE_SPOTS = [
  { asset: "PURR/USDC", szDecimals: 0, minPrice: "0.0001", minSize: "1" },
  { asset: "HYPE/USDC", szDecimals: 2, minPrice: "0.001", minSize: "0.01" },
  { asset: "UETH/USDC", szDecimals: 4, minPrice: "0.1", minSize: "0.0001" },
] as const;

// ============================================================
// Tests
// ============================================================

describe("formatPrice", () => {
  describe("sig figs", () => {
    test("integer bypasses limit", () => {
      assertEquals(formatPrice("1234567", 0), "1234567");
    });

    test("truncates to 5 sig figs", () => {
      assertEquals(formatPrice("12345.6", 0), "12345");
      assertEquals(formatPrice("0.00123456", 0), "0.001234");
    });
  });

  describe("decimal limits", () => {
    test("perp: 6 - szDecimals", () => {
      assertEquals(formatPrice("0.1234567", 0), "0.12345");
      assertEquals(formatPrice("123.456", 5), "123.4");
    });

    test("spot: 8 - szDecimals", () => {
      assertEquals(formatPrice("0.000123456", 0, "spot"), "0.00012345");
      assertEquals(formatPrice("0.0001234", 3, "spot"), "0.00012");
    });
  });

  describe("normalization", () => {
    test("removes trailing zeros", () => {
      assertEquals(formatPrice("1.1000", 0), "1.1");
    });

    test("removes leading zeros", () => {
      assertEquals(formatPrice("00.123", 0), "0.123");
    });
  });

  describe("edge cases", () => {
    test("zero throws FormatError", () => {
      assertThrows(() => formatPrice("0.0000001", 0), FormatError);
    });

    test("negative numbers supported", () => {
      assertEquals(formatPrice("-123.456", 0), "-123.45");
    });
  });

  test("invalid input throws", () => {
    assertThrows(() => formatPrice("abc", 0), FormatError);
    assertThrows(() => formatPrice(".", 0), FormatError);
    assertThrows(() => formatPrice("-.", 0), FormatError);
    assertThrows(() => formatPrice("", 0), FormatError);
  });

  describe("reference validation", () => {
    describe("perpetuals", () => {
      for (const { asset, szDecimals, minPrice } of REFERENCE_PERPS) {
        test(`${asset}`, () => {
          assertEquals(formatPrice(minPrice, szDecimals), minPrice);
        });
      }
    });

    describe("spots", () => {
      for (const { asset, szDecimals, minPrice } of REFERENCE_SPOTS) {
        test(`${asset}`, () => {
          assertEquals(formatPrice(minPrice, szDecimals, "spot"), minPrice);
        });
      }
    });
  });
});

describe("formatSize", () => {
  test("truncates to szDecimals", () => {
    assertEquals(formatSize("123.456789", 2), "123.45");
  });

  describe("normalization", () => {
    test("removes trailing zeros", () => {
      assertEquals(formatSize("1.0000", 4), "1");
    });

    test("removes leading zeros", () => {
      assertEquals(formatSize("00.123", 3), "0.123");
    });
  });

  describe("edge cases", () => {
    test("zero throws FormatError", () => {
      assertThrows(() => formatSize("0.0000001", 0), FormatError);
    });

    test("negative numbers supported", () => {
      assertEquals(formatSize("-10.5", 1), "-10.5");
    });
  });

  test("invalid input throws", () => {
    assertThrows(() => formatSize("invalid", 0), FormatError);
    assertThrows(() => formatSize(".", 0), FormatError);
    assertThrows(() => formatSize("-.", 0), FormatError);
    assertThrows(() => formatSize("", 0), FormatError);
  });

  describe("reference validation", () => {
    describe("perpetuals", () => {
      for (const { asset, szDecimals, minSize } of REFERENCE_PERPS) {
        test(`${asset}`, () => {
          assertEquals(formatSize(minSize, szDecimals), minSize);
        });
      }
    });

    describe("spots", () => {
      for (const { asset, szDecimals, minSize } of REFERENCE_SPOTS) {
        test(`${asset}`, () => {
          assertEquals(formatSize(minSize, szDecimals), minSize);
        });
      }
    });
  });
});

// ============================================================
// Conformance: parity with the previous decimal.js implementation
// ============================================================

/** Cloned exactly as the previous implementation did (ROUND_DOWN = truncate toward zero). */
const D = Decimal.clone({ rounding: Decimal.ROUND_DOWN });

/** The oracle: the pre-rewrite decimal.js implementation of the same parse step. */
function refToDecimal(value: string | number, field: "price" | "size"): Decimal {
  let d: Decimal;
  try {
    d = new D(value);
  } catch {
    throw new FormatError(`Invalid ${field}: ${JSON.stringify(value)}`);
  }
  if (!d.isFinite()) {
    throw new FormatError(`Invalid ${field}: ${String(value)} is not finite`);
  }
  return d;
}

/** The oracle: the pre-rewrite decimal.js implementation of {@linkcode formatPrice}. */
function refFormatPrice(price: string | number, szDecimals: number, type: "perp" | "spot"): string {
  const d = refToDecimal(price, "price");
  const maxDecimals = Math.max((type === "perp" ? 6 : 8) - szDecimals, 0);
  let result = d.toDecimalPlaces(maxDecimals);
  if (!result.isInteger()) result = result.toSignificantDigits(5);
  if (result.isZero()) throw new FormatError("Price is too small and was truncated to 0");
  return result.toFixed();
}

/** The oracle: the pre-rewrite decimal.js implementation of {@linkcode formatSize}. */
function refFormatSize(size: string | number, szDecimals: number): string {
  const d = refToDecimal(size, "size");
  const result = d.toDecimalPlaces(szDecimals);
  if (result.isZero()) throw new FormatError("Size is too small and was truncated to 0");
  return result.toFixed();
}

/** Run `fn`, returning its value or — for a thrown error — a comparable `throw:<message>` token. */
function captureOutcome(fn: () => string): string {
  try {
    return fn();
  } catch (error) {
    return `throw:${(error as Error).message}`;
  }
}

/** Assert both implementations return the same string or throw the same message. */
function assertParity(value: string | number, szDecimals: number): void {
  for (const type of ["perp", "spot"] as const) {
    assertEquals(
      captureOutcome(() => formatPrice(value, szDecimals, type)),
      captureOutcome(() => refFormatPrice(value, szDecimals, type)),
      `formatPrice(${JSON.stringify(value)}, ${szDecimals}, ${JSON.stringify(type)})`,
    );
  }
  assertEquals(
    captureOutcome(() => formatSize(value, szDecimals)),
    captureOutcome(() => refFormatSize(value, szDecimals)),
    `formatSize(${JSON.stringify(value)}, ${szDecimals})`,
  );
}

/** mulberry32: a small deterministic PRNG so the random sweep is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random decimal spanning magnitudes ~1e-20..1e20, covering the 1e-10..1e21 band. */
function randomValue(rand: () => number): string | number {
  let s = String(1 + Math.floor(rand() * 9)); // leading digit non-zero
  const intLen = Math.floor(rand() * 6);
  for (let i = 0; i < intLen; i++) s += String(Math.floor(rand() * 10));
  const fracLen = Math.floor(rand() * 12);
  if (fracLen > 0) {
    s += ".";
    for (let i = 0; i < fracLen; i++) s += String(Math.floor(rand() * 10));
  }
  if (rand() < 0.7) {
    const exp = Math.floor(rand() * 41) - 20;
    s += `e${exp >= 0 ? "+" : ""}${exp}`;
  }
  if (rand() < 0.3) s = `-${s}`;
  else if (rand() < 0.1) s = `+${s}`;
  // Sometimes exercise the number-input path instead of the string one.
  if (rand() < 0.3) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

describe("decimal.js conformance", () => {
  test("random sweep matches decimal.js", () => {
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 2000; i++) {
      assertParity(randomValue(rand), Math.floor(rand() * 9)); // szDecimals 0..8
    }
  });

  test("adversarial inputs match decimal.js", () => {
    const adversarial: (string | number)[] = [
      // zeros and near-zeros
      "0",
      "-0",
      "0.0",
      "0e5",
      0,
      -0,
      // scientific notation and extreme exponents
      "1e-7",
      "1E+7",
      "123.e5",
      "1e21",
      "1e+21",
      "1e-21",
      "1e9000000000000001", // overflows decimal.js's maxE → Infinity
      "1e-9000000000000001", // underflows decimal.js's minE → zero
      // normalization
      "1.2300",
      "00.123",
      ".5",
      "5.",
      "+1.5",
      "-.5",
      // tiny and huge magnitudes, very long digit strings
      "0.000000001",
      "0.00000000000000000001",
      `${"9".repeat(40)}.${"9".repeat(40)}`,
      "999999999999999999999999.999999",
      // numeric separators (accepted by decimal.js)
      "1_000.5",
      "1_0",
      // non-finite
      "Infinity",
      "-Infinity",
      "NaN",
      "-NaN",
      Infinity,
      -Infinity,
      NaN,
      // unparsable
      "abc",
      "",
      ".",
      "-.",
      "1e",
      "1e+",
      "1.2.3",
      "--1",
      " 1",
      "1 ",
      "1x",
      "infinity",
      // number inputs
      0.1,
      1e-7,
      1e21,
      -123.456,
      5e-324,
      1.7976931348623157e308,
      123456789,
    ];
    for (const value of adversarial) {
      for (let szDecimals = 0; szDecimals <= 8; szDecimals++) {
        assertParity(value, szDecimals);
      }
    }
  });

  test("non-decimal radices are rejected (documented deviation from decimal.js)", () => {
    // decimal.js silently parses "0x10" as 16; a price/size formatter should not.
    for (const value of ["0x10", "0b101", "0o17", "0x1.8p1"]) {
      assertThrows(() => formatPrice(value, 0), FormatError);
      assertThrows(() => formatSize(value, 0), FormatError);
    }
  });
});
