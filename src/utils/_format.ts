/**
 * Price and size formatting per Hyperliquid tick and lot size rules.
 *
 * The exact decimal machinery lives in `./_decimal.ts`, shared with the
 * SymbolConverter tick helpers; this module keeps only the float64 decomposition
 * (`floatToWire`'s input) and the rule composition.
 *
 * @module
 */

import {
  type DecimalParts,
  FormatError,
  isInteger,
  stripTrailingZeros,
  toDecimal,
  toDecimalPlaces,
  toDecimalPlacesHalfEven,
  toFixed,
  toSignificantDigits,
  toSignificantDigitsHalfEven,
} from "./_decimal.ts";

export { FormatError } from "./_decimal.ts";

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

  // Fast path: for |x| < 1e21, native `toFixed` renders the EXACT stored double (V8/JSC exact-mode
  // dtoa — `1e18 + 128` comes out as "1000000000000000128.000000000"), byte-identical to CPython's
  // fixed-point render on every input EXCEPT an exact 8-decimal tie, where it rounds half-up while
  // Python rounds half-even (repro: -233095212199.9004 → toFixed gives …063, Python gives …062).
  // The 1e-12 guard does NOT catch that — both candidates parse back to x — so ties must not take
  // this path. A tie means the exact expansion terminates in digit 5 at the 9th decimal, so
  // `toFixed(9)` ending in "5" detects every potential tie (no false negatives; false positives
  // only cost the slow path). The 8-decimal wire string is then derived from the SAME 9-decimal
  // render — digit 9 (never 5 here) is the round digit: 0-4 truncate, 6-9 round digit 8 up with
  // carry. Byte-identical to `x.toFixed(8)`: the 9-decimal render lies within 0.5e-9 of the exact
  // double, and only a 5e-9 tie (already excluded) sits close enough to the 8-decimal rounding
  // boundary for that gap to flip the result. |x| >= 1e21 takes the slow path: toFixed degenerates
  // to `String()` (exponent form) there. This path never exceeds 28 significant digits (≤ 20
  // integer digits + 8 decimals below 1e20; doubles in [1e20, 1e21) are integers), so the
  // context-28 normalize below can only strip here.
  if (Math.abs(x) < 1e21) {
    const round9 = x.toFixed(9);
    if (!round9.endsWith("5")) {
      let wire: string;
      if (round9.charCodeAt(round9.length - 1) < 53 /* "5" */) {
        // Digit 9 of 0-4: the 8-decimal render truncates.
        wire = round9.slice(0, -1);
      } else {
        // Digit 9 of 6-9: round digit 8 up, carrying left through any run of 9s (hopping the
        // decimal point); a carry that reaches the sign or the first digit grows the integer
        // part ("9.999999999" → "10.00000000", "-9.…" → "-10.…").
        let i = round9.length - 2;
        while (round9.charCodeAt(i) === 57 /* "9" */) {
          i -= round9.charCodeAt(i - 1) === 46 /* "." */ ? 2 : 1;
        }
        // Zero the carried 9-run; the decimal point inside it (if any) keeps its place.
        const dot = round9.length - 10; // index of "." in a 9-decimal render
        const zeros = i < dot ? `${"0".repeat(dot - i - 1)}.00000000` : "0".repeat(round9.length - 2 - i);
        wire =
          i >= 0 && round9.charCodeAt(i) !== 45 /* "-" */
            ? round9.slice(0, i) + String.fromCharCode(round9.charCodeAt(i) + 1) + zeros
            : `${round9.slice(0, i + 1)}1${zeros}`;
      }
      // The render pads to exactly 8 decimals; strip the padding (Python's
      // `Decimal(rounded).normalize()`): trailing zeros, then a bare decimal point. "-0.00000000"
      // collapses to "0" — the documented -0 mapping. A manual strip rather than the
      // scanDecimal/toFixed round-trip: the string shape is fixed, so no parse is needed, and it
      // is ~90 ns/call cheaper (see tests/perf float_to_wire).
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
