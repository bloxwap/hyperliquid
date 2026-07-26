/**
 * Tests for SymbolConverter tick helpers: getTickSize conformance with the
 * Hyperliquid tick rules across price magnitudes and szDecimals, and roundPrice
 * direction control per side and aggressiveness. Fed by a stub transport, so the
 * whole file runs offline.
 * @module
 */

import { beforeAll, describe, test } from "bun:test";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { Decimal } from "decimal.js";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { FormatError, formatPrice, SymbolConverter } from "@bloxwap/hyperliquid/utils";

// ============================================================
// Helpers
// ============================================================

/**
 * Builds a request transport serving fixed metadata: perps P0-P5 covering szDecimals 0-5,
 * spot pairs covering szDecimals 0/2/4, and one builder dex ("test") with a single asset.
 */
function createTickTransport(): IRequestTransport {
  const responses: Record<string, unknown> = {
    meta: {
      universe: [0, 1, 2, 3, 4, 5].map((szDecimals) => ({
        name: `P${szDecimals}`,
        szDecimals,
        maxLeverage: 50,
      })),
    },
    spotMeta: {
      tokens: [
        { name: "USDC", szDecimals: 8, index: 0 },
        { name: "PURR", szDecimals: 0, index: 1 },
        { name: "HYPE", szDecimals: 2, index: 2 },
        { name: "UETH", szDecimals: 4, index: 3 },
      ],
      universe: [
        { name: "PURR/USDC", tokens: [1, 0], index: 0 },
        { name: "@107", tokens: [2, 0], index: 107 },
        { name: "@108", tokens: [3, 0], index: 108 },
      ],
    },
    outcomeMeta: { outcomes: [], questions: [] },
    perpDexs: [null, { name: "test" }],
  };
  const dexMeta = { universe: [{ name: "test:ABC", szDecimals: 0, maxLeverage: 20 }] };
  return {
    isTestnet: false,
    request<T>(_endpoint: "info" | "exchange" | "explorer", payload: unknown): Promise<T> {
      const { type, dex } = payload as { type: string; dex?: string };
      if (type === "meta" && dex !== undefined) return Promise.resolve(dexMeta as T);
      return Promise.resolve(responses[type] as T);
    },
  };
}

// ============================================================
// Test Data
// ============================================================

/**
 * Hand-computed ticks per the docs rules (max 5 significant figures; max `6 - szDecimals`
 * decimals for perps, `8 - szDecimals` for spot; integers exempt from the sig-fig cap),
 * across magnitudes 0.00000001..100000 and szDecimals 0..5.
 */
const TICK_EXPECTATIONS: { coin: string; price: string; tick: string }[] = [
  // Perp, szDecimals=0 (max 6 decimals)
  { coin: "P0", price: "0.0001", tick: "0.000001" },
  { coin: "P0", price: "0.001", tick: "0.000001" },
  { coin: "P0", price: "0.5", tick: "0.00001" },
  { coin: "P0", price: "1.2345", tick: "0.0001" },
  { coin: "P0", price: "12.345", tick: "0.001" },
  { coin: "P0", price: "123.45", tick: "0.01" },
  { coin: "P0", price: "1234.5", tick: "0.1" },
  { coin: "P0", price: "12345", tick: "1" },
  { coin: "P0", price: "99999", tick: "1" },
  // Integer exemption: above 99999 the sig-fig cap alone would force a tick of 10,
  // but every integer is valid, so the tick stays 1.
  { coin: "P0", price: "100000", tick: "1" },
  { coin: "P0", price: "123456", tick: "1" },
  // Perp, szDecimals=1 (max 5 decimals)
  { coin: "P1", price: "0.0001", tick: "0.00001" },
  { coin: "P1", price: "1.2345", tick: "0.0001" },
  { coin: "P1", price: "12345", tick: "1" },
  // Perp, szDecimals=2 (max 4 decimals)
  { coin: "P2", price: "0.0001", tick: "0.0001" },
  { coin: "P2", price: "0.01", tick: "0.0001" },
  { coin: "P2", price: "1.2345", tick: "0.0001" },
  { coin: "P2", price: "123.45", tick: "0.01" },
  // Perp, szDecimals=3 (max 3 decimals)
  { coin: "P3", price: "0.0001", tick: "0.001" },
  { coin: "P3", price: "0.1", tick: "0.001" },
  { coin: "P3", price: "123.45", tick: "0.01" },
  // Perp, szDecimals=4 (max 2 decimals)
  { coin: "P4", price: "0.0001", tick: "0.01" },
  { coin: "P4", price: "0.1", tick: "0.01" },
  { coin: "P4", price: "1234.5", tick: "0.1" },
  { coin: "P4", price: "12345", tick: "1" },
  // Perp, szDecimals=5 (max 1 decimal)
  { coin: "P5", price: "0.5", tick: "0.1" },
  { coin: "P5", price: "1.2", tick: "0.1" },
  { coin: "P5", price: "97123", tick: "1" },
  { coin: "P5", price: "123456", tick: "1" },
  // Spot, szDecimals=0 (max 8 decimals)
  { coin: "PURR/USDC", price: "0.0001", tick: "0.00000001" },
  { coin: "PURR/USDC", price: "0.00000001", tick: "0.00000001" },
  { coin: "PURR/USDC", price: "1.2345", tick: "0.0001" },
  { coin: "PURR/USDC", price: "123456", tick: "1" },
  // Spot, szDecimals=2 (max 6 decimals)
  { coin: "HYPE/USDC", price: "0.0001", tick: "0.000001" },
  { coin: "HYPE/USDC", price: "1.2345", tick: "0.0001" },
  // Spot, szDecimals=4 (max 4 decimals)
  { coin: "UETH/USDC", price: "0.0001", tick: "0.0001" },
  { coin: "UETH/USDC", price: "0.1", tick: "0.0001" },
  { coin: "UETH/USDC", price: "12345", tick: "1" },
  // Builder dex assets follow the perp formula
  { coin: "test:ABC", price: "0.0001", tick: "0.000001" },
  { coin: "test:ABC", price: "123.45", tick: "0.01" },
];

/** Coins exercised by the roundPrice oracle sweep: [coin, szDecimals, market type]. */
const ROUND_SWEEP_COINS: [coin: string, szDecimals: number, type: "perp" | "spot"][] = [
  ["P0", 0, "perp"],
  ["P1", 1, "perp"],
  ["P2", 2, "perp"],
  ["P3", 3, "perp"],
  ["P4", 4, "perp"],
  ["P5", 5, "perp"],
  ["PURR/USDC", 0, "spot"],
  ["HYPE/USDC", 2, "spot"],
  ["UETH/USDC", 4, "spot"],
  ["test:ABC", 0, "perp"],
];

/** Prices swept through roundPrice: on-tick, between-tick, decade boundaries, tiny values. */
const ROUND_SWEEP_PRICES = ["1.23456789", "0.0000123456789", "97123.456789", "99999.9", "0.9999999", "123.456"];

/** Expected rounding per side and aggressiveness: which way the result may move relative to the input. */
const ROUND_DIRECTIONS = [
  { side: "buy", aggressive: false, moves: "down" },
  { side: "buy", aggressive: true, moves: "up" },
  { side: "sell", aggressive: false, moves: "up" },
  { side: "sell", aggressive: true, moves: "down" },
] as const;

// ============================================================
// Tests
// ============================================================

describe("SymbolConverter tick helpers", () => {
  let converter: SymbolConverter;

  beforeAll(async () => {
    converter = await SymbolConverter.create({ transport: createTickTransport(), dexs: ["test"] });
  });

  describe("getTickSize()", () => {
    for (const { coin, price, tick } of TICK_EXPECTATIONS) {
      test(`${coin} @ ${price} → ${tick}`, () => {
        assertEquals(converter.getTickSize(coin, price), tick);
      });
    }

    test("accepts number prices", () => {
      assertEquals(converter.getTickSize("P5", 97123), "1");
      assertEquals(converter.getTickSize("P0", 1.2345), "0.0001");
    });

    test("unknown coin returns undefined, like getSzDecimals", () => {
      assertEquals(converter.getTickSize("NONEXISTENT", "1"), undefined);
      assertEquals(converter.getTickSize("NONE/EXISTENT", "1"), undefined);
      // A spot pair ID is not a coin name: getSzDecimals has no entry for it either.
      assertEquals(converter.getTickSize("@107", "1"), undefined);
      assertEquals(converter.getSzDecimals("@107"), undefined);
    });

    test("invalid price throws FormatError", () => {
      assertThrows(() => converter.getTickSize("P0", "abc"), FormatError);
      assertThrows(() => converter.getTickSize("P0", ""), FormatError);
      assertThrows(() => converter.getTickSize("P0", "Infinity"), FormatError);
      assertThrows(() => converter.getTickSize("P0", Number.NaN), FormatError);
      assertThrows(() => converter.getTickSize("P0", "0"), FormatError);
      assertThrows(() => converter.getTickSize("P0", "-5"), FormatError);
    });
  });

  describe("roundPrice()", () => {
    test("buy rounds down, sell rounds up by default", () => {
      assertEquals(converter.roundPrice("P0", "buy", "1.23456789"), "1.2345");
      assertEquals(converter.roundPrice("P0", "sell", "1.23456789"), "1.2346");
      assertEquals(converter.roundPrice("P5", "buy", "97123.456789"), "97123");
      assertEquals(converter.roundPrice("P5", "sell", "97123.456789"), "97124");
      assertEquals(converter.roundPrice("PURR/USDC", "buy", "0.0000123456789"), "0.00001234");
      assertEquals(converter.roundPrice("PURR/USDC", "sell", "0.0000123456789"), "0.00001235");
      assertEquals(converter.roundPrice("test:ABC", "buy", "123.456"), "123.45");
      assertEquals(converter.roundPrice("test:ABC", "sell", "123.456"), "123.46");
    });

    test("aggressive flips the direction", () => {
      assertEquals(converter.roundPrice("P0", "buy", "1.23456789", { aggressive: true }), "1.2346");
      assertEquals(converter.roundPrice("P0", "sell", "1.23456789", { aggressive: true }), "1.2345");
      assertEquals(converter.roundPrice("P5", "buy", "97123.456789", { aggressive: true }), "97124");
      assertEquals(converter.roundPrice("P5", "sell", "97123.456789", { aggressive: true }), "97123");
    });

    test("price exactly on a tick does not move, in any mode", () => {
      for (const { side, aggressive } of ROUND_DIRECTIONS) {
        assertEquals(converter.roundPrice("P0", side, "1.2345", { aggressive }), "1.2345");
        assertEquals(converter.roundPrice("P5", side, "97123", { aggressive }), "97123");
        assertEquals(converter.roundPrice("PURR/USDC", side, "0.00001234", { aggressive }), "0.00001234");
        // An integer with more than 5 significant figures is valid as-is.
        assertEquals(converter.roundPrice("P0", side, "123456", { aggressive }), "123456");
      }
    });

    test("rounding may cross a power-of-ten boundary and stays valid", () => {
      assertEquals(converter.roundPrice("P0", "sell", "99999.9"), "100000");
      assertEquals(converter.roundPrice("P0", "buy", "0.9999999"), "0.99999");
      assertEquals(converter.roundPrice("P0", "sell", "0.9999999"), "1");
    });

    test("rounding down to zero throws FormatError", () => {
      assertThrows(() => converter.roundPrice("P0", "buy", "0.0000001"), FormatError);
      assertThrows(() => converter.roundPrice("P0", "sell", "0.0000001", { aggressive: true }), FormatError);
      // The opposite direction rounds up onto the smallest tick instead.
      assertEquals(converter.roundPrice("P0", "sell", "0.0000001"), "0.000001");
      assertEquals(converter.roundPrice("P0", "buy", "0.0000001", { aggressive: true }), "0.000001");
    });

    test("unknown coin returns undefined, like getSzDecimals", () => {
      assertEquals(converter.roundPrice("NONEXISTENT", "buy", "1"), undefined);
      assertEquals(converter.roundPrice("@107", "sell", "1"), undefined);
      // The coin lookup wins over price validation, mirroring a plain getSzDecimals miss.
      assertEquals(converter.roundPrice("NONEXISTENT", "buy", "abc"), undefined);
    });

    test("invalid price throws FormatError", () => {
      assertThrows(() => converter.roundPrice("P0", "buy", "abc"), FormatError);
      assertThrows(() => converter.roundPrice("P0", "sell", ""), FormatError);
      assertThrows(() => converter.roundPrice("P0", "buy", "0"), FormatError);
      assertThrows(() => converter.roundPrice("P0", "sell", "-5"), FormatError);
    });

    test("accepts number prices", () => {
      assertEquals(converter.roundPrice("P0", "buy", 1.23456789), "1.2345");
      assertEquals(converter.roundPrice("P5", "sell", 97123.456789), "97124");
    });

    // Oracle sweep: every result must be a fixed point of formatPrice (i.e. an already-valid
    // tick), move in the documented direction, and stay within one tick of the input.
    describe("formatPrice oracle", () => {
      for (const [coin, szDecimals, type] of ROUND_SWEEP_COINS) {
        for (const price of ROUND_SWEEP_PRICES) {
          for (const { side, aggressive, moves } of ROUND_DIRECTIONS) {
            test(`${coin} ${side} ${price} aggressive=${aggressive}`, () => {
              const tick = converter.getTickSize(coin, price)!;
              let result: string | undefined;
              try {
                result = converter.roundPrice(coin, side, price, { aggressive });
              } catch (error) {
                // Only acceptable when a downward rounding of a sub-tick price collapses to 0.
                assertEquals(error instanceof FormatError, true);
                assertEquals(moves, "down");
                assertEquals(new Decimal(price).lt(tick), true);
                return;
              }
              assertEquals(typeof result, "string");

              // Validity: formatPrice (which truncates) must not need to change the result.
              assertEquals(formatPrice(result!, szDecimals, type), result!);

              // Direction: never moves against the documented rounding direction.
              const cmp = new Decimal(result!).comparedTo(price);
              assertEquals(moves === "down" ? cmp <= 0 : cmp >= 0, true);

              // Closeness: never more than one tick away from the requested price.
              assertEquals(new Decimal(result!).sub(price).abs().lte(tick), true);
            });
          }
        }
      }
    });
  });
});
