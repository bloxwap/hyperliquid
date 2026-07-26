/**
 * Price and size formatting per Hyperliquid tick and lot size rules.
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
interface DecimalParts {
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
function stripTrailingZeros(digits: string): string {
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
function toDecimal(value: string | number, field: "price" | "size"): DecimalParts {
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

/** Scratch view for {@linkcode exactDecimalParts}'s bit decomposition; reused across calls. */
const FLOAT64_VIEW = new DataView(new ArrayBuffer(8));

/**
 * Decompose a finite double into its EXACT decimal expansion as {@linkcode DecimalParts}.
 *
 * `String(number)` is shortest-roundtrip, which diverges from the stored binary value: above 2^53 it
 * picks a shorter neighbor (`String(1e18 + 128)` is "1000000000000000100", but the double is exactly
 * 1000000000000000128), and below it it hides the tail (0.1 is really
 * 0.1000000000000000055511151231257827021181583404541015625). CPython's `f"{x:.8f}"` renders the
 * exact binary value, so byte parity with Python requires the same input: decompose into
 * mantissa × 2^e, then expand with bigint arithmetic — shift left for `e >= 0`, and for `e < 0`
 * multiply by 5^(-e) and place the decimal point (binary fractions have finite decimal expansions,
 * so this is exact).
 *
 * @param x A finite double.
 */
function exactDecimalParts(x: number): DecimalParts {
  if (x === 0) return { sign: 1, digits: "", exp: 0 }; // covers -0: zero carries no sign by convention

  FLOAT64_VIEW.setFloat64(0, Math.abs(x));
  const high = FLOAT64_VIEW.getUint32(0);
  const low = FLOAT64_VIEW.getUint32(4);
  const exponentBits = (high >>> 20) & 0x7ff;

  let mantissa: bigint;
  let e: number;
  if (exponentBits === 0) {
    // Subnormal: no implicit leading bit, exponent fixed.
    mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    e = -1074;
  } else {
    mantissa = (BigInt((high & 0xfffff) | 0x100000) << 32n) | BigInt(low);
    e = exponentBits - 1075; // 1023 bias + 52 stored mantissa bits
  }

  const sign: 1 | -1 = x < 0 ? -1 : 1;
  if (e >= 0) {
    const digits = (mantissa << BigInt(e)).toString();
    return { sign, digits: stripTrailingZeros(digits), exp: digits.length };
  }
  // x = mantissa / 2^(-e) = mantissa × 5^(-e) × 10^e.
  const scaled = (mantissa * 5n ** BigInt(-e)).toString();
  return { sign, digits: stripTrailingZeros(scaled), exp: scaled.length + e };
}

/**
 * Truncate toward zero to `dp` decimal places — `toDecimalPlaces` with decimal.js's `ROUND_DOWN`.
 * Mutates and returns `value`, which never escapes the format pipeline.
 *
 * ROUND_DOWN (truncation) is a deliberate divergence from the Python SDK's half-even slippage
 * rounding — see the "Divergence from the Python SDK" note on `formatPrice`.
 */
function toDecimalPlaces(value: DecimalParts, dp: number): DecimalParts {
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
function toDecimalPlacesHalfEven(value: DecimalParts, dp: number): DecimalParts {
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
function toSignificantDigits(value: DecimalParts, sd: number): DecimalParts {
  if (value.digits.length > sd) value.digits = stripTrailingZeros(value.digits.slice(0, sd));
  return value;
}

/**
 * Round to `sd` significant digits, ties to even — `toSignificantDigits` with decimal.js's
 * `ROUND_HALF_EVEN`, and the rounding half of CPython's `Decimal.normalize()` under the default
 * context (precision 28). Mutates and returns `value`, which never escapes the format pipeline.
 */
function toSignificantDigitsHalfEven(value: DecimalParts, sd: number): DecimalParts {
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
function isInteger(value: DecimalParts): boolean {
  return value.exp >= value.digits.length;
}

/** Render in full decimal notation, as decimal.js's argument-less `toFixed` does. */
function toFixed(value: DecimalParts): string {
  const { sign, digits, exp } = value;
  if (digits === "") return "0";
  const minus = sign < 0 ? "-" : "";
  if (exp <= 0) return `${minus}0.${"0".repeat(-exp)}${digits}`;
  if (exp >= digits.length) return `${minus}${digits}${"0".repeat(exp - digits.length)}`;
  return `${minus}${digits.slice(0, exp)}.${digits.slice(exp)}`;
}

/**
 * Format price according to Hyperliquid {@link https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size | rules}:
 * - Maximum 5 significant figures
 * - Maximum 6 (for perp) or 8 (for spot) - `szDecimals` decimal places
 * - Integer prices are always allowed regardless of significant figures
 *
 * Divergence from the Python SDK: values are **truncated** (`ROUND_DOWN`), never rounded to nearest.
 * Python's `_slippage_price` rounds half-even (to 5 significant figures first, then to 6 decimals).
 * Truncation is kept deliberately: for a slippage-derived bound, a truncated buy price is never more
 * aggressive than intended, whereas half-even rounding can nudge the bound upward.
 *
 * @param price The price to format (as string or number).
 * @param szDecimals The size decimals of the asset.
 * @param type The market type: "perp" for perpetuals or "spot" for spot markets. Default: `"perp"`.
 * @return Formatted price string
 *
 * @throws {FormatError} If the price is not a valid finite number, or is truncated to 0.
 *
 * @example
 * ```ts
 * import { formatPrice } from "@bloxwap/hyperliquid/utils";
 *
 * formatPrice("97123.456789", 0); // → "97123" (perp, szDecimals=0)
 * formatPrice("1.23456789", 5); // → "1.2" (perp, szDecimals=5)
 * formatPrice("0.0000123456789", 0, "spot"); // → "0.00001234" (spot, 8-decimal ceiling)
 * ```
 */
export function formatPrice(price: string | number, szDecimals: number, type: "perp" | "spot" = "perp"): string {
  const d = toDecimal(price, "price");

  const maxDecimals = Math.max((type === "perp" ? 6 : 8) - szDecimals, 0);
  let result = toDecimalPlaces(d, maxDecimals);

  // Integers are exempt from the 5-sig-fig cap.
  if (!isInteger(result)) {
    result = toSignificantDigits(result, 5);
  }

  if (result.digits === "") {
    throw new FormatError("Price is too small and was truncated to 0");
  }

  return toFixed(result);
}

/**
 * Format size according to Hyperliquid {@link https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size | rules}:
 * - Truncate decimal places to `szDecimals`
 *
 * Divergence from the Python SDK: like {@linkcode formatPrice}, sizes are **truncated** (`ROUND_DOWN`)
 * rather than rounded half-even — see the note on `formatPrice` for the rationale.
 *
 * @param size The size to format (as string or number).
 * @param szDecimals The size decimals of the asset.
 * @return Formatted size string
 *
 * @throws {FormatError} If the size is not a valid finite number, or is truncated to 0.
 *
 * @example
 * ```ts
 * import { formatSize } from "@bloxwap/hyperliquid/utils";
 *
 * formatSize("1.23456789", 5); // → "1.23456"
 * formatSize("0.123456789", 2); // → "0.12"
 * formatSize("100", 0); // → "100"
 * ```
 */
export function formatSize(size: string | number, szDecimals: number): string {
  const d = toDecimal(size, "size");

  const result = toDecimalPlaces(d, szDecimals);

  if (result.digits === "") {
    throw new FormatError("Size is too small and was truncated to 0");
  }

  return toFixed(result);
}

/**
 * Convert a float to its wire string, mirroring the Python SDK's `float_to_wire`
 * ({@link https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/signing.py | signing.py}):
 * - Round to 8 decimal places, half-even (Python's `f"{x:.8f}"`)
 * - Throw if rounding changed the value by `>= 1e-12` (Python's `ValueError("float_to_wire causes rounding")`)
 * - Normalize under CPython's default decimal context (precision 28): results longer than 28
 *   significant digits round half-even to 28 — `Decimal.normalize()` rounds, it does not merely strip
 * - Strip trailing zeros and a bare decimal point; integers have no decimal point
 * - Never emit scientific notation
 *
 * Decisions where JavaScript and Python differ:
 * - **Negatives are accepted** and keep their sign — `float_to_wire` is used for both signed and unsigned
 *   contexts in Python, so the sign is mirrored and callers validate it, exactly as in Python.
 * - **Any value rounding to zero maps to `"0"`**, including `-0` and tiny negatives that pass the precision
 *   guard. This is an INTENTIONAL divergence (requested in issue #15), pinned in tests: Python intends
 *   the same (`if rounded == "-0": rounded = "0"`) but the guard never fires there — `f"{x:.8f}"` always
 *   carries a fraction — so CPython actually emits `"-0"` (e.g. for `-5e-324`). `"0"` matches this SDK's
 *   decimal schemas, which collapse negative zero.
 * - **Non-finite input throws.** Python would emit `"inf"`/`"nan"` strings that the exchange rejects
 *   anyway; this SDK's format helpers refuse non-finite values, so `floatToWire` does too.
 *
 * @param x The float to convert.
 * @return The wire string.
 *
 * @throws {FormatError} If `x` is not finite, or rounding to 8 decimals changes it by `>= 1e-12`.
 *
 * @example
 * ```ts
 * import { floatToWire } from "@bloxwap/hyperliquid/utils";
 *
 * floatToWire(1e-8);                // → "0.00000001"
 * floatToWire(1e20);                // → "100000000000000000000"
 * floatToWire(1.2300000000000002);  // → "1.23"
 * floatToWire(0.30000000000000004); // → "0.3"
 * floatToWire(-0);                  // → "0"
 * floatToWire(0.000012345678);      // → throws FormatError
 * ```
 */
export function floatToWire(x: number): string {
  if (!Number.isFinite(x)) {
    throw new FormatError(`floatToWire: ${String(x)} is not finite`);
  }

  // Fast path: for |x| < 1e21, native `toFixed(8)` renders the EXACT stored double (V8/JSC exact-mode
  // dtoa — `1e18 + 128` comes out as "1000000000000000128.00000000"), byte-identical to CPython's
  // `f"{x:.8f}"` on every input EXCEPT an exact 8-decimal tie, where it rounds half-up while Python
  // rounds half-even (repro: -233095212199.9004 → toFixed gives …063, Python gives …062). The 1e-12
  // guard does NOT catch that — both candidates parse back to x — so ties must not take this path.
  // A tie means the exact expansion terminates in digit 5 at the 9th decimal, so `toFixed(9)` ending
  // in "5" detects every potential tie (no false negatives; false positives only cost the slow path).
  // |x| >= 1e21 also takes the slow path: toFixed degenerates to `String()` (exponent form) there.
  // This path never exceeds 28 significant digits (≤ 20 integer digits + 8 decimals below 1e20;
  // doubles in [1e20, 1e21) are integers), so the context-28 normalize below can only strip here.
  if (Math.abs(x) < 1e21 && !x.toFixed(9).endsWith("5")) {
    let wire = x.toFixed(8);
    // toFixed pads to exactly 8 decimals; strip the padding (Python's `Decimal(rounded).normalize()`):
    // trailing zeros, then a bare decimal point. "-0.00000000" collapses to "0" — the documented -0
    // mapping. A manual strip rather than the scanDecimal/toFixed round-trip: the string shape is
    // fixed, so no parse is needed, and it is ~90 ns/call cheaper (see tests/perf float_to_wire).
    let end = wire.length;
    while (wire.charCodeAt(end - 1) === 48) end--; // "0"
    if (wire.charCodeAt(end - 1) === 46) end--; // "."
    wire = wire.slice(0, end);
    if (wire === "-0") wire = "0";
    // Python: `if abs(float(rounded) - x) >= 1e-12: raise ValueError("float_to_wire causes rounding")`.
    // Python's `float()` is the nearest double to the decimal string — exactly what `Number()` parses.
    if (Math.abs(Number(wire) - x) >= 1e-12) {
      throw new FormatError(`floatToWire causes rounding: ${x}`);
    }
    return wire;
  }

  // Exact path: render the double's exact binary value via {@linkcode exactDecimalParts} — CPython's
  // `f"{x:.8f}"` does the same, so the rounding input is byte-identical to Python's on every double,
  // including integers above 2^53 where shortest-roundtrip `String(x)` diverges (`1e18 + 128` is
  // stored as 1000000000000000128, not …100). An exact tie at the 8th decimal (e.g. 1/512 =
  // 0.001953125) always trips the guard below — a tie moves the value by exactly 5e-9 — so half-even
  // vs round-half-up is unobservable here; half-even matches Python.
  const rounded = toDecimalPlacesHalfEven(exactDecimalParts(x), 8);
  const wire = toFixed(rounded); // zero renders as "0" with no sign — the documented -0 collapse

  // Python: `if abs(float(rounded) - x) >= 1e-12: raise ValueError("float_to_wire causes rounding", x)`.
  if (Math.abs(Number(wire) - x) >= 1e-12) {
    throw new FormatError(`floatToWire causes rounding: ${x}`);
  }

  // Python's last step is `Decimal(rounded).normalize()` under the DEFAULT decimal context (precision
  // 28): normalize ROUNDS half-even to 28 significant digits when there are more — it does not merely
  // strip zeros (e.g. 1e29 renders "99999999999999991433150857220", not …216). The guard above is
  // applied to the 8-decimal string BEFORE this rounding, exactly as Python does.
  return toFixed(toSignificantDigitsHalfEven(rounded, 28));
}
