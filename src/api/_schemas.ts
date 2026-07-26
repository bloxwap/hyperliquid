// deno-lint-ignore-file valibot-project/require-name-suffix

/**
 * Common valibot schemas for primitive types used across the API.
 * @module
 */

import * as v from "valibot";
import { HyperliquidError } from "../_base.ts";

// ============================================================
// Number
// ============================================================

/** Unsigned decimal number as a string (e.g., "123.45"). */
export const UnsignedDecimal = /* @__PURE__ */ (() => {
  return v.pipe(
    v.union([v.string(), v.number()]),
    v.toString(),
    v.string(), // HACK: for correct JSONSchema generation
    v.transform((value) => normalizeDecimalString(value)),
    v.regex(/^[0-9]+(\.[0-9]+)?$/),
  );
})();
export type UnsignedDecimal = v.InferOutput<typeof UnsignedDecimal>;

/** Decimal number as a string, can be negative (e.g., "-123.45"). */
export const Decimal = /* @__PURE__ */ (() => {
  return v.pipe(
    v.union([v.string(), v.number()]),
    v.toString(),
    v.string(), // HACK: for correct JSONSchema generation
    v.transform((value) => normalizeDecimalString(value)),
    v.regex(/^-?[0-9]+(\.[0-9]+)?$/),
  );
})();
export type Decimal = v.InferOutput<typeof Decimal>;

/** Safe integer number (>= Number.MIN_SAFE_INTEGER & <= Number.MAX_SAFE_INTEGER). */
export const Integer = /* @__PURE__ */ (() => {
  return v.pipe(
    v.union([v.string(), v.number()]),
    v.toNumber(),
    v.number(), // HACK: for correct JSONSchema generation
    v.safeInteger(),
  );
})();
export type Integer = v.InferOutput<typeof Integer>;

/** Unsigned safe integer number (>= 0 & <= Number.MAX_SAFE_INTEGER). */
export const UnsignedInteger = /* @__PURE__ */ (() => {
  return v.pipe(
    v.union([v.string(), v.number()]),
    v.toNumber(),
    v.number(), // HACK: for correct JSONSchema generation
    v.safeInteger(),
    v.minValue(0),
  );
})();
export type UnsignedInteger = v.InferOutput<typeof UnsignedInteger>;

/**
 * Normalize a decimal string: expand exponent notation, drop redundant leading and trailing
 * zeros, and collapse negative zero. A string that is not a well-formed decimal is returned
 * unchanged (and is later rejected by the decimal regex).
 *
 * Exponent expansion is an exact string rewrite — it only relocates the decimal point and never
 * emits more precision than the input digits carry. For number inputs the digits come from
 * `String(number)`, the shortest round-trip representation, so no invented precision either
 * (e.g. `1e-8` becomes `"0.00000001"`, matching the Python SDK's `float_to_wire`).
 *
 * @example
 * ```ts ignore
 * normalizeDecimalString("00123");  // => "123"
 * normalizeDecimalString("1.2000"); // => "1.2"
 * normalizeDecimalString(".5");     // => "0.5"
 * normalizeDecimalString("-0.0");   // => "0"
 * normalizeDecimalString("1e-8");   // => "0.00000001"
 * normalizeDecimalString("1.23e-7");// => "0.000000123"
 * normalizeDecimalString("1.5e+3"); // => "1500"
 * normalizeDecimalString("1.0.0");  // => "1.0.0" (not a decimal — unchanged)
 * ```
 */
function normalizeDecimalString(value: string): string {
  const match = expandExponentNotation(value).match(/^(-?)([0-9]*)(?:\.([0-9]*))?$/);
  if (!match) return value;
  const [, sign, intRaw, fracRaw = ""] = match;
  if (intRaw === "" && fracRaw === "") return value;

  const int = intRaw.replace(/^0+/, "") || "0";

  let fracEnd = fracRaw.length;
  while (fracEnd > 0 && fracRaw[fracEnd - 1] === "0") fracEnd--;
  const frac = fracRaw.slice(0, fracEnd);

  const body = frac === "" ? int : `${int}.${frac}`;
  return sign === "-" && body !== "0" ? `-${body}` : body;
}

/**
 * Expand exponent notation (e.g. `"1e-8"`, `"1.5E+3"`) to plain decimal digits.
 * A string that is not exponent notation is returned unchanged.
 */
function expandExponentNotation(value: string): string {
  const match = value.match(/^(-?)([0-9]+)(?:\.([0-9]+))?[eE]([+-]?[0-9]+)$/);
  if (!match) return value;
  const [, sign, intPart, fracPart = "", expPart] = match;

  const digits = intPart + fracPart;
  const point = intPart.length + Number(expPart); // decimal point position relative to `digits` start
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

// ============================================================
// Hex
// ============================================================

/** Hexadecimal string starting with "0x". */
export const Hex = /* @__PURE__ */ (() => {
  return v.pipe(
    v.string(),
    v.regex(/^0[xX][0-9a-fA-F]+$/),
    v.transform((value) => value.toLowerCase() as `0x${string}`),
  );
})();
export type Hex = v.InferOutput<typeof Hex>;

/** Ethereum address (42 characters hex string). */
export const Address = /* @__PURE__ */ (() => {
  return v.pipe(Hex, v.length(42));
})();
export type Address = v.InferOutput<typeof Address>;

/** Client order ID (34 characters hex string). */
export const Cloid = /* @__PURE__ */ (() => {
  return v.pipe(Hex, v.length(34));
})();
export type Cloid = v.InferOutput<typeof Cloid>;

/**
 * Build a client order ID from a non-negative integer, mirroring the Python SDK's `Cloid.from_int`
 * (`f"{oid:#034x}"`): `"0x"` followed by 32 lowercase hex digits, zero-padded.
 *
 * Divergence from Python: out-of-range input is rejected instead of silently producing an invalid cloid.
 * Python's format width is a minimum, so `oid >= 2**128` yields an over-long string there; here negatives
 * and values `>= 2^128` throw, as do numbers that are not safe integers (pass a `bigint` beyond `2^53 - 1`).
 *
 * @param n The integer to convert (`0 <= n < 2^128`).
 * @return The cloid string.
 *
 * @throws {HyperliquidError} If `n` is negative, `>= 2^128`, or a number that is not a safe integer.
 *
 * @example
 * ```ts
 * import { cloidFromInt } from "@bloxwap/hyperliquid/api/exchange";
 *
 * cloidFromInt(0);               // → "0x00000000000000000000000000000000"
 * cloidFromInt(1);               // → "0x00000000000000000000000000000001"
 * cloidFromInt(2n ** 128n - 1n); // → "0xffffffffffffffffffffffffffffffff"
 * ```
 */
export function cloidFromInt(n: bigint | number): Cloid {
  if (typeof n === "number" && !Number.isSafeInteger(n)) {
    throw new HyperliquidError(`cloidFromInt: number must be a safe integer, got ${n}`);
  }
  const value = BigInt(n);
  if (value < 0n || value >= 2n ** 128n) {
    throw new HyperliquidError(`cloidFromInt: integer out of range [0, 2^128): ${n}`);
  }
  return `0x${value.toString(16).padStart(32, "0")}`;
}

// ============================================================
// Other
// ============================================================

/** Percentage string (e.g., "50%"). */
export const Percent = /* @__PURE__ */ (() => {
  return v.pipe(
    v.string(),
    v.regex(/^[0-9]+(\.[0-9]+)?%$/),
    v.transform((value) => value as `${string}%`),
  );
})();
export type Percent = v.InferOutput<typeof Percent>;
