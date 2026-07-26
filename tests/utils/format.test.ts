/**
 * Tests for the price/size formatters: significant-figure caps, decimal limits
 * per market type, normalization, and the documented reference values.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { Decimal } from "decimal.js";
import { FormatError, floatToWire, formatPrice, formatSize } from "@bloxwap/hyperliquid/utils";

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

describe("floatToWire", () => {
  // Fixtures pin the Python SDK's `float_to_wire` outputs exactly (hyperliquid/utils/signing.py).
  describe("python parity fixtures", () => {
    test("documented outputs", () => {
      assertEquals(floatToWire(1e-8), "0.00000001");
      assertEquals(floatToWire(1e20), "100000000000000000000");
      assertEquals(floatToWire(1.2300000000000002), "1.23");
      assertEquals(floatToWire(0.30000000000000004), "0.3");
      assertEquals(floatToWire(-0), "0");
      assertEquals(floatToWire(2.5), "2.5");
    });

    test("integers have no decimal point", () => {
      assertEquals(floatToWire(0), "0");
      assertEquals(floatToWire(100), "100");
    });

    test("never emits scientific notation", () => {
      assertEquals(floatToWire(1e21), "1000000000000000000000");
      assertEquals(floatToWire(1.2e-7), "0.00000012");
    });

    test("precision-loss guard throws", () => {
      assertThrows(() => floatToWire(0.000012345678), FormatError);
      assertThrows(() => floatToWire(-0.000012345678), FormatError);
      // An exact tie at the 8th decimal (1/512) moves the value by exactly 5e-9 — always caught.
      assertThrows(() => floatToWire(0.001953125), FormatError);
      // Just under the guard threshold, the same rounding is allowed through.
      assertEquals(floatToWire(0.0000123499999), "0.00001235");
    });
  });

  describe("documented decisions", () => {
    test("negatives are accepted (callers validate sign, as in Python)", () => {
      assertEquals(floatToWire(-2.5), "-2.5");
      assertEquals(floatToWire(-0.00001235), "-0.00001235");
    });

    test('values rounding to zero collapse to "0"', () => {
      assertEquals(floatToWire(-0), "0");
      // Tiny negatives below the guard threshold; CPython emits "-0" here (its `-0` guard is dead code).
      assertEquals(floatToWire(-1e-13), "0");
    });

    test("non-finite input throws", () => {
      assertThrows(() => floatToWire(Number.NaN), FormatError);
      assertThrows(() => floatToWire(Number.POSITIVE_INFINITY), FormatError);
      assertThrows(() => floatToWire(Number.NEGATIVE_INFINITY), FormatError);
    });
  });

  describe("exact binary expansion (CPython byte parity)", () => {
    test("integers at and above 2^53 render the exact stored value", () => {
      // Reviewer counterexample: the double is exactly 1000000000000000128, but shortest-roundtrip
      // `String()` yields "1000000000000000100"; CPython's `f"{x:.8f}"` renders the exact value.
      assertEquals(floatToWire(1e18 + 128), "1000000000000000128");
      assertEquals(floatToWire(1e18 + 256), "1000000000000000256");
      // Literals above 2^53 round to the nearest double first — 2^53 + 1 is stored as 2^53.
      assertEquals(floatToWire(2 ** 53), "9007199254740992");
      assertEquals(floatToWire(2 ** 53 + 1), "9007199254740992");
      // biome-ignore lint/correctness/noPrecisionLoss: the literal rounding to 2^53 is the case under test
      assertEquals(floatToWire(9.007199254740993e15), "9007199254740992");
      assertEquals(floatToWire(2 ** 53 + 2), "9007199254740994");
      // 1e20 is exactly representable (5^20 fits the 53-bit mantissa).
      assertEquals(floatToWire(1e20), "100000000000000000000");
    });

    test("exact fractional tails still round and guard identically", () => {
      assertEquals(floatToWire(0.1), "0.1");
      assertEquals(floatToWire(0.30000000000000004), "0.3");
      // The min subnormal rounds to zero and passes the guard (delta 4.9e-324 < 1e-12); CPython
      // returns '0' here too — the guard only trips at deltas >= 1e-12.
      assertEquals(floatToWire(5e-324), "0");
      assertEquals(floatToWire(1e15 + 0.5), "1000000000000000.5");
    });

    // 128 doubles from an xorshift32 PRNG (seed 0x9e3779b9) across magnitudes 1e-10..1e21, positive
    // and negative. Inputs are the exact decimal expansions of the doubles, so `Number(input)`
    // reproduces the double exactly; expected outputs were computed with CPython's `float_to_wire`
    // (`f"{x:.8f}"` + 1e-12 guard + normalize). `null` marks Python's ValueError.
    const SWEEP: readonly (readonly [string, string | null])[] = [
      ["0.0000000001316593533614650503639329892958151173310010761952071334235370159149169921875", null],
      ["-0.0000000001875706985127180869019616233042582580103907474722291226498782634735107421875", null],
      ["0.0000000001483300162944942660297019853255754036347457969213792239315807819366455078125", null],
      ["-0.00000000010059152070898562492294405472330180197071403114250642829574644565582275390625", null],
      ["0.000000001899222202366218241200459710695501447386135396300232969224452972412109375", null],
      ["-0.00000000197475923388265096010436505592940126252443633347866125404834747314453125", null],
      ["0.0000000017271295674145222547930192080159646217385471800298546440899372100830078125", null],
      ["-0.000000001988219126826152282668559790929259378788884760069777257740497589111328125", null],
      ["0.000000016592701806221158539667696082790804279483154459740035235881805419921875", null],
      ["-0.0000000170840953104197972288943465322963444208426153636537492275238037109375", null],
      ["0.0000000110364782391116029992177418272113198494110974934301339089870452880859375", null],
      ["-0.000000019730325164273380886075819258020092039629389546462334692478179931640625", null],
      ["0.000000142879538680426765753813506641678454656130270450375974178314208984375", null],
      ["-0.00000012780657550320029849279398169448196398434447473846375942230224609375", null],
      ["0.000000104724792949855328499651524638835997649266573716886341571807861328125", null],
      ["-0.00000012651561719831077461168836358063050084865608369000256061553955078125", null],
      ["0.000001056532534305006220063109963203107355411702883429825305938720703125", null],
      ["-0.00000146139150066301226049410126595073933231105911545455455780029296875", null],
      ["0.00000105777910281904026653342076880193189936107955873012542724609375", null],
      ["-0.00000196056039608083641217627264563549971398970228619873523712158203125", null],
      ["0.000015188644377049060233222411986364619451705948449671268463134765625", null],
      ["-0.00001645369164180010665594899865737943400745280086994171142578125", null],
      ["0.00001475336959585547616231708534240141261761891655623912811279296875", null],
      ["-0.000010113823791034520888326535270618222739358316175639629364013671875", null],
      ["0.00017022853558883071557229771375574500780203379690647125244140625", null],
      ["-0.00011935845783445984242231163729996978872804902493953704833984375", null],
      ["0.00018172190138138831602861167358042848718469031155109405517578125", null],
      ["-0.0001313718232791870918312049365539451173390261828899383544921875", null],
      ["0.0019739720749203117609871238613550303853116929531097412109375", null],
      ["-0.001982095387764275240538580646898481063544750213623046875", null],
      ["0.00167452255776152024967229348106911857030354440212249755859375", null],
      ["-0.001514905428979545880252555178913098643533885478973388671875", null],
      ["0.0173963513481430707974251248515429324470460414886474609375", null],
      ["-0.019087583574000747954624301883086445741355419158935546875", null],
      ["0.0198929344280622914797884703830277430824935436248779296875", null],
      ["-0.012838006899692118445432953421914135105907917022705078125", null],
      ["0.11115689571015537062681488578164135105907917022705078125", null],
      ["-0.13342159683816134929656982421875", null],
      ["0.1703950445633381771681769123460981063544750213623046875", null],
      ["-0.1575676254695281552908880939867231063544750213623046875", null],
      ["1.10667339642532169818878173828125", null],
      ["-1.40129390056245028972625732421875", null],
      ["1.11863822699524462223052978515625", null],
      ["-1.482237559743225574493408203125", null],
      ["17.760085142217576503753662109375", null],
      ["-18.9742293325252830982208251953125", null],
      ["19.2114420165307819843292236328125", null],
      ["-19.933798103593289852142333984375", null],
      ["148.982488247565925121307373046875", null],
      ["-182.6577869243919849395751953125", null],
      ["161.91288712434470653533935546875", null],
      ["-136.715781618840992450714111328125", null],
      ["1080.04143764264881610870361328125", null],
      ["-1286.118702031672000885009765625", null],
      ["1756.57815090380609035491943359375", null],
      ["-1480.76864518225193023681640625", null],
      ["19381.5150647424161434173583984375", null],
      ["-14175.4400101490318775177001953125", null],
      ["10811.6526366211473941802978515625", null],
      ["-15915.3280965983867645263671875", null],
      ["141570.5894120037555694580078125", null],
      ["-162204.829417169094085693359375", null],
      ["157557.03556351363658905029296875", null],
      ["-172850.875556468963623046875", null],
      ["1215126.95099227130413055419921875", null],
      ["-1726125.34812651574611663818359375", null],
      ["1537121.1101301014423370361328125", null],
      ["-1697345.848195254802703857421875", null],
      ["13032433.204352855682373046875", null],
      ["-17191515.3670124709606170654296875", "-17191515.36701247"],
      ["17027356.72704875469207763671875", null],
      ["-19379197.2030885517597198486328125", "-19379197.20308855"],
      ["152197771.030478179454803466796875", "152197771.03047818"],
      ["-140660248.487256467342376708984375", "-140660248.48725647"],
      ["193393282.755278050899505615234375", "193393282.75527805"],
      ["-116344194.114208221435546875", "-116344194.11420822"],
      ["1666650386.294350147247314453125", "1666650386.29435015"],
      ["-1666986237.04724025726318359375", "-1666986237.04724026"],
      ["1493664172.9436814785003662109375", "1493664172.94368148"],
      ["-1700814306.968822956085205078125", "-1700814306.96882296"],
      ["15325444352.34740447998046875", "15325444352.34740448"],
      ["-12987663520.0344028472900390625", "-12987663520.03440285"],
      ["14493614423.55438995361328125", "14493614423.55438995"],
      ["-13709207698.70281219482421875", "-13709207698.70281219"],
      ["169850614760.071044921875", "169850614760.07104492"],
      ["-195095286611.46759033203125", "-195095286611.46759033"],
      ["124776545306.6676788330078125", "124776545306.66767883"],
      ["-134808652661.74078369140625", "-134808652661.74078369"],
      ["1217482692329.213134765625", "1217482692329.21313477"],
      ["-1578477586619.555908203125", "-1578477586619.5559082"],
      ["1594463046872.98828125", "1594463046872.98828125"],
      ["-1630479121813.550537109375", "-1630479121813.55053711"],
      ["12447608774527.908203125", "12447608774527.90820312"],
      ["-14025472423527.390625", "-14025472423527.390625"],
      ["14543159638997.16796875", "14543159638997.16796875"],
      ["-10316358190029.859375", "-10316358190029.859375"],
      ["100703949364833.53125", "100703949364833.53125"],
      ["-180813902895897.625", "-180813902895897.625"],
      ["159761231695301.84375", "159761231695301.84375"],
      ["-137189941783435.640625", "-137189941783435.640625"],
      ["1075424122158438", "1075424122158438"],
      ["-1368847407633438.75", "-1368847407633438.75"],
      ["1157866045134142", "1157866045134142"],
      ["-1729339734185487", "-1729339734185487"],
      ["11452880271244794", "11452880271244794"],
      ["-18218423156067728", "-18218423156067728"],
      ["11195076028816402", "11195076028816402"],
      ["-19979806391056628", "-19979806391056628"],
      ["178097132802940896", "178097132802940896"],
      ["-149774493020959200", "-149774493020959200"],
      ["180065482109785088", "180065482109785088"],
      ["-149754079175181696", "-149754079175181696"],
      ["1107190269744023680", "1107190269744023680"],
      ["-1148916763020679296", "-1148916763020679296"],
      ["1664623966207727872", "1664623966207727872"],
      ["-1346076814457774080", "-1346076814457774080"],
      ["16947866983246057472", "16947866983246057472"],
      ["-10671493050176651264", "-10671493050176651264"],
      ["19101282793562857472", "19101282793562857472"],
      ["-15957461332436649984", "-15957461332436649984"],
      ["158144057309255008256", "158144057309255008256"],
      ["-105812547984533012480", "-105812547984533012480"],
      ["177273143455386173440", "177273143455386173440"],
      ["-162670398387126632448", "-162670398387126632448"],
      ["1907962518977001291776", "1907962518977001291776"],
      ["-1047431282931938754560", "-1047431282931938754560"],
      ["1834879047470167359488", "1834879047470167359488"],
      ["-1745378419989720072192", "-1745378419989720072192"],
    ];

    test("differential sweep vs CPython float_to_wire", () => {
      for (const [input, expected] of SWEEP) {
        if (expected === null) {
          assertThrows(() => floatToWire(Number(input)), FormatError, undefined, `floatToWire(${input}) should throw`);
        } else {
          assertEquals(floatToWire(Number(input)), expected, `floatToWire(${input})`);
        }
      }
    });
  });

  describe("tie detection and path boundaries", () => {
    test("8-decimal ties round half-even even when the guard passes", () => {
      // Reviewer repro: the double IS the exact tie …900390625; half-even keeps the even digit.
      // A bare `toFixed(8)` fast path would emit …063, and the 1e-12 guard cannot catch it —
      // both candidates parse back to the same double at this magnitude.
      assertEquals(floatToWire(-233095212199.9004), "-233095212199.90039062");
      assertEquals(floatToWire(233095212199.9004), "233095212199.90039062");
    });

    test("toFixed(9)-ends-in-5 values that pass the guard round correctly", () => {
      // False-positive predicate hits (9th decimal 5 without an exact tie) take the exact path.
      // Pinned from the CPython differential sweep; the doubles' exact binary expansions are
      //   165447253.989987075328826904296875
      //   181072224.81630742549896240234375
      //   195078029.2041599750518798828125
      // — the literals below are the same doubles' shortest round-trip forms.
      assertEquals(floatToWire(-165447253.98998708), "-165447253.98998708");
      assertEquals(floatToWire(-181072224.81630743), "-181072224.81630743");
      assertEquals(floatToWire(-195078029.20415998), "-195078029.20415998");
    });

    test("exact binary ties at the 8th decimal always throw via the guard", () => {
      // m/512 for odd m: the decimal expansion ends in 5 at the 9th place — an exact tie moves
      // the value by exactly 5e-9, tripping the 1e-12 guard.
      assertThrows(() => floatToWire(0.001953125), FormatError); // 1/512
      assertThrows(() => floatToWire(0.005859375), FormatError); // 3/512
      assertThrows(() => floatToWire(-0.005859375), FormatError);
      assertThrows(() => floatToWire(7.998046875), FormatError); // 4095/512
    });

    test("|x| >= 1e21 takes the exact path (toFixed degenerates to exponent form)", () => {
      assertEquals(floatToWire(1e21), "1000000000000000000000");
      assertEquals(floatToWire(-1e21), "-1000000000000000000000");
      assertEquals(floatToWire(1e25), "10000000000000000905969664");
      assertEquals(floatToWire(1.5e25), "15000000000000000285212672");
    });

    test("subnormals round to zero and pass the guard", () => {
      assertEquals(floatToWire(5e-324), "0");
      assertEquals(floatToWire(1e-310), "0");
    });
  });
});
