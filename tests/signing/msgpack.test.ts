/**
 * Differential fixtures for the action MessagePack encoder and L1 hash preimage.
 *
 * `src/signing/_msgpack.ts` replaced `@std/msgpack` on the action-hash hot path, and its output is hashed and
 * signed — a single differing byte would authorize a payload the user never approved. So `@std/msgpack` is kept
 * as a devDependency purely to serve as the oracle here: every fixture is encoded with both and the bytes must
 * match exactly, and the L1 hashes are pinned to literals captured from the pre-replacement implementation.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { encode as encodeReference } from "@jsr/std__msgpack/encode";

import { createL1ActionHash } from "@bloxwap/hyperliquid/signing";
import { encode, type MsgpackValue } from "../../src/signing/_msgpack.ts";

// --- Fixtures ------------------------------------------------

const ORDER_ACTION = {
  type: "order",
  orders: [
    {
      a: 0,
      b: true,
      p: "30000",
      s: "0.001",
      r: false,
      t: { limit: { tif: "Gtc" } },
    },
  ],
  grouping: "na",
} as const;

const CANCEL_ACTION = {
  type: "cancel",
  cancels: [
    { a: 0, o: 1234567890 },
    { a: 1, o: 4294967295 },
  ],
  f: true,
} as const;

const TWAP_ORDER_ACTION = {
  type: "twapOrder",
  twap: {
    a: 0,
    b: true,
    s: "0.25",
    r: false,
    m: 30,
    t: true,
  },
} as const;

const NULL_PROTOTYPE_MAP = Object.create(null) as Record<string, MsgpackValue>;
NULL_PROTOTYPE_MAP.type = "cancel";
NULL_PROTOTYPE_MAP.cancels = [{ a: 0, o: 42 }];

const FIFTEEN_ELEMENT_MAP = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`k${index}`, index]));
const SIXTEEN_ELEMENT_MAP = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`k${index}`, index]));
const MAP_65536 = Object.fromEntries(Array.from({ length: 65536 }, (_, index) => [`k${index}`, index % 128]));

const CORPUS: readonly MsgpackValue[] = [
  {},
  [],
  { outer: [{ middle: [null, true, false, { inner: ["value", -1, 1] }] }] },
  NULL_PROTOTYPE_MAP,
  "a".repeat(31),
  "a".repeat(32),
  "a".repeat(255),
  "a".repeat(256),
  "a".repeat(65535),
  "a".repeat(65536),
  "é",
  "€",
  "😀",
  "e\u0301",
  "before\uD800after",
  // The str header is chosen on UTF-8 BYTE length, not `.length` — these cross the 31/32 and 255/256 byte
  // boundaries while their char counts (15..17, 127..129) stay well inside the fixstr range. A UTF-8-unaware
  // fast path would pick the wrong header for them.
  "\u00e9".repeat(15),
  "\u00e9".repeat(16),
  "\u00e9".repeat(17),
  "\u00e9".repeat(127),
  "\u00e9".repeat(128),
  "\u00e9".repeat(129),
  "\u{1f600}".repeat(8),
  `${"a".repeat(31)}\u00e9`,
  -32,
  -33,
  0,
  -0,
  -1,
  -(2 ** 53 - 1),
  127,
  128,
  255,
  256,
  65535,
  65536,
  4294967295,
  4294967296,
  -128,
  -129,
  -32768,
  -32769,
  -2147483648,
  -2147483649,
  2 ** 53 - 1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  0n,
  -1n,
  2n ** 63n - 1n,
  -(2n ** 63n),
  2n ** 64n - 1n,
  true,
  false,
  null,
  new Uint8Array(),
  new Uint8Array(255),
  new Uint8Array(256),
  new Uint8Array(65535),
  new Uint8Array(65536),
  Array.from({ length: 15 }, (_, index) => index),
  Array.from({ length: 16 }, (_, index) => index),
  Array.from({ length: 65535 }, (_, index) => index % 128),
  Array.from({ length: 65536 }, (_, index) => index % 128),
  FIFTEEN_ELEMENT_MAP,
  SIXTEEN_ELEMENT_MAP,
  MAP_65536,
  ORDER_ACTION,
  CANCEL_ACTION,
  TWAP_ORDER_ACTION,
];

// --- Randomized trees ----------------------------------------

/**
 * Leaves the random generator draws from: every scalar boundary the encoder branches on, minus the multi-KiB
 * strings — a nested tree multiplies leaf size, and the fixtures already cover those headers directly.
 */
const RANDOM_LEAVES: readonly MsgpackValue[] = CORPUS.filter(
  (value) => (typeof value !== "object" || value === null) && !(typeof value === "string" && value.length > 300),
).concat(["", "Gtc", "0.001", "0x1234567890123456789012345678901234567890"]);

/** xorshift32, so a failure is reproducible rather than a one-off CI flake. */
let randomState = 0x9e3779b9;

/** Next pseudo-random float in `[0, 1)`. */
function nextRandom(): number {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  randomState |= 0;
  return (randomState >>> 0) / 4294967296;
}

/**
 * A random value up to `depth` containers deep.
 *
 * @param depth Remaining nesting budget.
 * @return The generated value.
 */
function randomTree(depth: number): MsgpackValue {
  // Containers are drawn 40% of the time so nesting, and not merely the leaf set, actually gets exercised.
  if (depth > 0 && nextRandom() < 0.4) {
    const length = Math.floor(nextRandom() * 20);
    if (nextRandom() < 0.5) return Array.from({ length }, () => randomTree(depth - 1));

    const map: Record<string, MsgpackValue> = {};
    // Non-ASCII keys included: keys go through the same string encoder as values.
    for (let i = 0; i < length; i++) map[`${nextRandom() < 0.5 ? "k" : "é"}${i}`] = randomTree(depth - 1);
    return map;
  }
  return RANDOM_LEAVES[Math.floor(nextRandom() * RANDOM_LEAVES.length)];
}

// --- Differential encoding -----------------------------------

describe("MessagePack encoding", () => {
  test("matches @std/msgpack across the supported corpus", () => {
    for (const [index, value] of CORPUS.entries()) {
      // The index is in the message because most fixtures are megabyte-scale or unprintable, so a bare
      // byte-array diff would not say which one broke.
      expect(encode(value), `CORPUS[${index}]`).toEqual(encodeReference(value));
    }
  });

  test("matches @std/msgpack across a randomized tree corpus", () => {
    // Fixtures only cover the boundaries someone thought of. This walks 5000 pseudo-random trees built from
    // the edge-case leaves above, so an unnoticed interaction (a container header straddling a buffer grow,
    // a non-ASCII key, a float nested under a 16-bit map) still gets caught. The seed is fixed so a failure
    // is reproducible.
    for (let index = 0; index < 5000; index++) {
      const value = randomTree(3);
      expect(encode(value), `random tree #${index}`).toEqual(encodeReference(value));
    }
  });

  test("returns an independent exact-length copy", () => {
    const first = encode({ type: "cancel", cancels: [{ a: 0, o: 42 }] });
    const snapshot = first.slice();

    encode({ type: "order", orders: [] });

    expect(first).toEqual(snapshot);
    expect(first.byteLength).toBe(first.buffer.byteLength);
  });

  test("rejects bigint values outside the 64-bit range with the reference error", () => {
    const values = [-(2n ** 63n) - 1n, 2n ** 64n];

    for (const value of values) {
      expect(() => encodeReference(value)).toThrow("Cannot safely encode bigint larger than 64 bits");
      expect(() => encode(value)).toThrow("Cannot safely encode bigint larger than 64 bits");
    }
  });
});

// --- L1 hash compatibility -----------------------------------

describe("createL1ActionHash()", () => {
  const nonce = 1700000000000;
  const vaultAddress = "0x1234567890123456789012345678901234567890";
  const expiresAfter = 1700000005000;

  test("keeps the known-good base hash", () => {
    expect(createL1ActionHash({ action: ORDER_ACTION, nonce })).toBe(
      "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d",
    );
  });

  test("keeps the known-good vault hash", () => {
    expect(createL1ActionHash({ action: ORDER_ACTION, nonce, vaultAddress })).toBe(
      "0x97b7dcbe2aab13e2cbf892b763539fc8523bbca25581bde7cbeac086bd6386c9",
    );
  });

  test("keeps the known-good expiry hash", () => {
    expect(createL1ActionHash({ action: ORDER_ACTION, nonce, expiresAfter })).toBe(
      "0x0c512d99d15f7ea570cb78d8394e1e5e8f7926c92365ffd1300a21de0e679204",
    );
  });

  test("keeps the known-good vault and expiry hash", () => {
    expect(createL1ActionHash({ action: ORDER_ACTION, nonce, vaultAddress, expiresAfter })).toBe(
      "0xc97ab6a8dfcf13f067c465d93b93b1d925d193f5103a995116598f5431d770fe",
    );
  });

  test("carries no state between calls", () => {
    // The encoder reuses one buffer across calls. A leftover offset or a stale tail would show up as the
    // second hash of an identical action differing from the first, or as a large action bleeding into a
    // small one that follows it.
    const before = createL1ActionHash({ action: ORDER_ACTION, nonce });
    createL1ActionHash({
      action: { type: "cancel", cancels: Array.from({ length: 500 }, (_, i) => ({ a: i, o: i })) },
      nonce,
      vaultAddress,
      expiresAfter,
    });
    expect(createL1ActionHash({ action: ORDER_ACTION, nonce })).toBe(before);
  });

  test("is not corrupted by an action that re-enters it from a getter", () => {
    // `adjust` hands the caller's own object to the encoder when nothing needs normalizing, so a getter on
    // the action can call back in while the outer call is mid-write. Sharing one buffer across both would
    // splice the inner preimage into the outer one and sign the wrong bytes.
    const reentrant: Record<string, unknown> = {
      type: "order",
      get orders(): unknown {
        createL1ActionHash({ action: CANCEL_ACTION, nonce: 42 });
        return ORDER_ACTION.orders;
      },
      grouping: "na",
    };

    expect(createL1ActionHash({ action: reentrant, nonce })).toBe(
      "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d",
    );
  });

  test("recovers the shared buffer after an action that fails to encode", () => {
    // A throw mid-write must not leave the reused writer poisoned for the next caller.
    expect(() => createL1ActionHash({ action: { type: "order", bad: () => 0 } as never, nonce })).toThrow();

    expect(createL1ActionHash({ action: ORDER_ACTION, nonce })).toBe(
      "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d",
    );
  });
});
