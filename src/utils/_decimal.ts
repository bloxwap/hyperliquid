/**
 * Exact base-10 decimal machinery shared by the price/size formatters (`_format.ts`) and the
 * SymbolConverter tick helpers (`_symbolConverter.ts`): parsing into a normalized
 * `sign × 0.digits × 10^exp` form, toward-zero truncation and half-even rounding, and rendering —
 * all pure string manipulation, no floats and no arbitrary-precision library.
 *
 * @module
 */

import { HyperliquidError } from "../_base.ts";

/**
 * Thrown when a price or size value cannot be formatted to a valid decimal.
 *
 * @example
 * ```ts
 * import { formatPrice, FormatError } from "@bloxwap/hyperliquid/utils";
 *
 * try {
 *   formatPrice("not a number", 0);
 * } catch (error) {
 *   if (error instanceof FormatError) {
 *     console.error(error.message);
 *   }
 * }
 * ```
 */
export class FormatError extends HyperliquidError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FormatError";
  }
}

/**
 * A finite decimal as `sign × 0.digits × 10^exp`, the same normalized form decimal.js
 * uses internally: `digits` carries no leading or trailing zeros, and empty means zero.
 */
export interface DecimalParts {
  /** Sign of the value; irrelevant (always `1` by convention) when {@linkcode digits} is empty. */
  sign: 1 | -1;
  /** Significant digits with leading and trailing zeros stripped; empty for zero. */
  digits: string;
  /** Base-10 exponent of the first significant digit: `value = sign × 0.digits × 10^exp`. */
  exp: number;
}

// decimal.js's default exponent bounds (`maxE`/`minE`), kept so extreme exponents resolve
// to Infinity / zero exactly as `new Decimal()` would.
const MAX_EXP = 9e15;
const MIN_EXP = -9e15;

/** Whether an ASCII char code is a digit — the `\d` of decimal.js's acceptance grammar. */
function isDigit(code: number): boolean {
  return code >= 48 && code <= 57; // "0"-"9"
}

/** Remove trailing zeros from a normalized digit string (returns the input unchanged if there are none). */
export function stripTrailingZeros(digits: string): string {
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end--; // "0"
  return end === digits.length ? digits : digits.slice(0, end);
}

/**
 * Scan a sign-stripped string as a plain decimal: `\d+(\.\d*)?` or `\.\d+`, with an
 * optional `e[+-]?\d+` exponent — the exact grammar decimal.js accepts for decimal input.
 *
 * @return The parsed parts (value `sign × 0.digits × 10^exp`), or `null` if the string does not match.
 */
function scanDecimal(str: string, sign: 1 | -1): DecimalParts | null {
  const len = str.length;
  let i = 0;

  // Integer part.
  while (i < len && isDigit(str.charCodeAt(i))) i++;
  const intEnd = i;

  // Fraction part.
  let dot = -1;
  let fracEnd = -1;
  if (i < len && str.charCodeAt(i) === 46) {
    // "."
    dot = i++;
    fracEnd = i;
    while (fracEnd < len && isDigit(str.charCodeAt(fracEnd))) fracEnd++;
    i = fracEnd;
  }
  if (intEnd === 0 && fracEnd <= dot + 1) return null; // no mantissa digits at all

  const mantissaEnd = i;

  // Exponent part.
  let exponent = 0;
  if (i < len && (str.charCodeAt(i) === 101 || str.charCodeAt(i) === 69)) {
    // "e" | "E"
    const expStart = ++i;
    if (i < len && (str.charCodeAt(i) === 43 || str.charCodeAt(i) === 45)) i++; // "+" | "-"
    const digitsStart = i;
    while (i < len && isDigit(str.charCodeAt(i))) i++;
    if (i === digitsStart) return null; // "1e" / "1e+" are not valid
    exponent = Number(str.slice(expStart, i));
  }
  if (i !== len) return null; // trailing garbage

  // Merge the mantissa into one digit string and normalize it.
  const pointPos = dot < 0 ? mantissaEnd : dot;
  const raw = dot < 0 ? str.slice(0, mantissaEnd) : str.slice(0, dot) + str.slice(dot + 1, mantissaEnd);
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) === 48) start++; // "0"
  while (end > start && raw.charCodeAt(end - 1) === 48) end--; // "0"
  if (start === end) return { sign, digits: "", exp: 0 }; // zero
  if (start === 0 && end === raw.length) return { sign, digits: raw, exp: pointPos + exponent };

  return { sign, digits: raw.slice(start, end), exp: pointPos + exponent - start };
}

/**
 * Parse a string or number into finite decimal parts.
 *
 * @throws {FormatError} If the value is unparsable or not finite.
 */
export function toDecimal(value: string | number, field: "price" | "size"): DecimalParts {
  let str = typeof value === "number" ? String(value) : value;

  let sign: 1 | -1 = 1;
  const first = str.charCodeAt(0);
  if (first === 45) {
    // "-"
    sign = -1;
    str = str.slice(1);
  } else if (first === 43) {
    // "+"
    str = str.slice(1);
  }

  // decimal.js also accepts numeric separators between digits ("1_000.5").
  if (str.indexOf("_") > -1) str = str.replace(/(\d)_(?=\d)/g, "$1");

  const parsed = scanDecimal(str, sign);
  if (parsed !== null) {
    // Below minE the value collapses to zero; within bounds it is finite.
    if (parsed.digits === "" || parsed.exp - 1 < MIN_EXP) return { sign, digits: "", exp: 0 };
    if (parsed.exp - 1 <= MAX_EXP) return parsed;
    // Past maxE the value overflows to Infinity and is rejected below.
  } else if (str !== "Infinity" && str !== "NaN") {
    throw new FormatError(`Invalid ${field}: ${JSON.stringify(value)}`, {
      cause: new Error(`Not a decimal: ${JSON.stringify(str)}`),
    });
  }
  // "NaN", "Infinity", or exponent overflow — all rejected as not finite.
  throw new FormatError(`Invalid ${field}: ${String(value)} is not finite`);
}

/**
 * Truncate toward zero to `dp` decimal places — `toDecimalPlaces` with decimal.js's `ROUND_DOWN`.
 * Mutates and returns `value`, which never escapes the format pipeline.
 *
 * ROUND_DOWN (truncation) is a deliberate divergence from the Python SDK's half-even slippage
 * rounding — see the "Divergence from the Python SDK" note on `formatPrice`.
 */
export function toDecimalPlaces(value: DecimalParts, dp: number): DecimalParts {
  // Significant digits sitting at or above the 10^-dp place.
  const keep = value.exp + dp;
  if (keep <= 0) value.digits = "";
  else if (keep < value.digits.length) value.digits = stripTrailingZeros(value.digits.slice(0, keep));
  return value;
}

/**
 * Round to `dp` decimal places, ties to even — `toDecimalPlaces` with decimal.js's `ROUND_HALF_EVEN`.
 * Mutates and returns `value`, which never escapes the format pipeline.
 */
export function toDecimalPlacesHalfEven(value: DecimalParts, dp: number): DecimalParts {
  // Significant digits sitting at or above the 10^-dp place.
  const keep = value.exp + dp;
  if (keep <= 0) {
    // Everything sits below the 10^-dp place; round up to one unit there only past half a unit. An exact
    // half ties to the implicit leading 0, which is even. digits is normalized (no leading/trailing zeros),
    // so lexicographic comparison against "5" is the numeric comparison against half a unit.
    if (keep === 0 && value.digits > "5") {
      value.digits = "1";
      value.exp = 1 - dp;
    } else {
      value.digits = "";
    }
    return value;
  }
  if (keep >= value.digits.length) return value; // already an integer multiple of 10^-dp

  const rest = value.digits.slice(keep);
  // Round up when the discarded tail exceeds half a unit, or ties it with an odd preceding digit
  // (digit char codes are odd exactly when the digit is).
  const roundUp = rest > "5" || (rest === "5" && value.digits.charCodeAt(keep - 1) % 2 === 1);
  value.digits = value.digits.slice(0, keep);
  if (roundUp) {
    // Increment the kept digits: flip the rightmost non-"9" up and zero the run after it; a run reaching
    // the front ("999…") carries out as 0.1 × 10^(exp+1).
    let i = keep - 1;
    while (i >= 0 && value.digits.charCodeAt(i) === 57) i--; // "9"
    if (i < 0) {
      value.digits = "1";
      value.exp += 1;
    } else {
      value.digits =
        value.digits.slice(0, i) + String.fromCharCode(value.digits.charCodeAt(i) + 1) + "0".repeat(keep - 1 - i);
    }
  }
  value.digits = stripTrailingZeros(value.digits);
  return value;
}

/**
 * Truncate toward zero to `sd` significant digits — `toSignificantDigits` with `ROUND_DOWN`.
 * Mutates and returns `value`, which never escapes the format pipeline.
 */
export function toSignificantDigits(value: DecimalParts, sd: number): DecimalParts {
  if (value.digits.length > sd) value.digits = stripTrailingZeros(value.digits.slice(0, sd));
  return value;
}

/**
 * Round to `sd` significant digits, ties to even — `toSignificantDigits` with decimal.js's
 * `ROUND_HALF_EVEN`, and the rounding half of CPython's `Decimal.normalize()` under the default
 * context (precision 28). Mutates and returns `value`, which never escapes the format pipeline.
 */
export function toSignificantDigitsHalfEven(value: DecimalParts, sd: number): DecimalParts {
  if (value.digits.length <= sd) return value;
  const rest = value.digits.slice(sd);
  // Round up when the discarded tail exceeds half a unit, or ties it with an odd preceding digit
  // (digit char codes are odd exactly when the digit is; digits is normalized, so lexicographic
  // comparison against "5" is the numeric comparison against half a unit).
  const roundUp = rest > "5" || (rest === "5" && value.digits.charCodeAt(sd - 1) % 2 === 1);
  value.digits = value.digits.slice(0, sd);
  if (roundUp) {
    // Increment the kept digits: flip the rightmost non-"9" up and zero the run after it; a run
    // reaching the front ("999…") carries out as 0.1 × 10^(exp+1).
    let i = sd - 1;
    while (i >= 0 && value.digits.charCodeAt(i) === 57) i--; // "9"
    if (i < 0) {
      value.digits = "1";
      value.exp += 1;
    } else {
      value.digits =
        value.digits.slice(0, i) + String.fromCharCode(value.digits.charCodeAt(i) + 1) + "0".repeat(sd - 1 - i);
    }
  }
  value.digits = stripTrailingZeros(value.digits);
  return value;
}

/** Whether the value has no fractional part (zero counts as an integer). */
export function isInteger(value: DecimalParts): boolean {
  return value.exp >= value.digits.length;
}

/** Render in full decimal notation, as decimal.js's argument-less `toFixed` does. */
export function toFixed(value: DecimalParts): string {
  const { sign, digits, exp } = value;
  if (digits === "") return "0";
  const minus = sign < 0 ? "-" : "";
  if (exp <= 0) return `${minus}0.${"0".repeat(-exp)}${digits}`;
  if (exp >= digits.length) return `${minus}${digits}${"0".repeat(exp - digits.length)}`;
  return `${minus}${digits.slice(0, exp)}.${digits.slice(exp)}`;
}
