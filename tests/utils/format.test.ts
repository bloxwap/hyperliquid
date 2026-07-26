/**
 * Tests for the price/size formatters: significant-figure caps, decimal limits
 * per market type, normalization, and the documented reference values.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertThrows } from "@jsr/std__assert";
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
