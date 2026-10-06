/**
 * Byte-equality fixtures for the wide-integer arm of the L1 encoder (`MsgpackWriter.numberL1` in
 * `src/signing/_msgpack.ts`).
 *
 * A safe integer outside the int32/uint32 forms (`>= 2^32` or `< -2^31`) takes the 9-byte int64/uint64
 * form. The encoder used to get there by allocating a `BigInt` per value; it now splits the double at
 * 2^32 and writes two 32-bit halves. These bytes are hashed and signed — wide integers are every live
 * order ID in a cancel or modify — so the new arm is pinned three independent ways:
 *
 * 1. against `@std/msgpack` encoding `BigInt(value)` (the reference implementation the encoder mirrors)
 *    and against the strict in-house `bigint` path the arm replaced, across every int/uint width
 *    boundary, both halves' edge values, and a seeded random corpus;
 * 2. against hand-derived big-endian two's-complement literals that depend on no encoder at all;
 * 3. through the full signing path: L1 action hashes and ECDSA signatures for representative actions
 *    carrying wide integers, pinned to literals captured from the pre-change (BigInt) implementation.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { encode as encodeReference } from "@jsr/std__msgpack/encode";
import { bytesToHex } from "@noble/hashes/utils.js";
import { privateKeyToAccount } from "viem/accounts";

import { createL1ActionHash, signL1Action } from "@bloxwap/hyperliquid/signing";
import { encode, type L1Value, MsgpackWriter } from "../../src/signing/_msgpack.ts";

// --- Helpers ------------------------------------------------------------------

/** Encodes one value through the L1 entry point under test. */
function encodeL1(value: L1Value): Uint8Array {
  const writer = new MsgpackWriter();
  writer.valueL1(value);
  return writer.view().slice();
}

/** Whether `value` takes the wide (int64/uint64) arm rather than the int32/uint32/float64 selection. */
function isWide(value: number): boolean {
  return Number.isSafeInteger(value) && (value >= 2 ** 32 || value < -(2 ** 31));
}

/** xorshift32, so a failure is reproducible rather than a one-off CI flake. */
let randomState = 0x2545f491;

/** Next pseudo-random unsigned 32-bit integer. */
function nextUint32(): number {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState >>> 0;
}

// --- Fixtures -----------------------------------------------------------------

/**
 * Every width boundary the encoder or the 2^32 split branches on, approached from both sides: powers of
 * two from 2^31 through 2^53 (the int32 floor, the uint32 ceiling, every bit of the high half up to the
 * safe-integer limit), each ±2, in both signs. Values that do not take the wide arm are kept too, so the
 * classification itself (int32/uint32 vs. int64/uint64 vs. float64) stays pinned.
 */
const BOUNDARIES: readonly number[] = (() => {
  const values = new Set<number>();
  for (let exponent = 31; exponent <= 53; exponent++) {
    for (const delta of [-2, -1, 0, 1, 2]) {
      values.add(2 ** exponent + delta);
      values.add(-(2 ** exponent) + delta);
    }
  }
  // Each half at its own edges: low half 0, 1, 2^31 (sign bit of the low word) and 2^32-1, under high
  // halves 1, 2, the widest safe high half, and their negative counterparts.
  for (const high of [1, 2, 0x7fff, 0x1fffff, -1, -2, -0x8000, -0x200000]) {
    for (const low of [0, 1, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1]) {
      const value = high * 2 ** 32 + low;
      if (Number.isSafeInteger(value)) values.add(value);
    }
  }
  values.add(Number.MAX_SAFE_INTEGER);
  values.add(Number.MIN_SAFE_INTEGER);
  return [...values].sort((a, b) => a - b);
})();

/** Wide safe integers of every magnitude: a random high half in [0, 2^21) and a random low half, both signs. */
const RANDOM_WIDE: readonly number[] = Array.from({ length: 20_000 }, () => {
  const magnitude = (nextUint32() % 2 ** 21) * 2 ** 32 + nextUint32();
  return nextUint32() & 1 ? -magnitude : magnitude;
}).filter(isWide);

/** Hand-derived encodings: tag byte, then the 64-bit big-endian two's-complement value. */
const LITERALS: readonly (readonly [number, string])[] = [
  [2 ** 32, "cf0000000100000000"],
  [2 ** 33 - 1, "cf00000001ffffffff"],
  [41234567890, "cf0000000999c592d2"], // a realistic order ID: high half 9, low half 0x99c592d2
  [2 ** 53 - 1, "cf001fffffffffffff"],
  [-(2 ** 31) - 1, "d3ffffffff7fffffff"],
  [-(2 ** 32), "d3ffffffff00000000"],
  [-(2 ** 32) - 1, "d3fffffffeffffffff"],
  [-(2 ** 53 - 1), "d3ffe0000000000001"],
];

// --- Byte-level equality ------------------------------------------------------

describe("MsgpackWriter.valueL1() wide safe integers", () => {
  test("classify every width boundary exactly as before", () => {
    const tags = new Map<number, number>();
    for (const value of BOUNDARIES) tags.set(value, encodeL1(value)[0]);

    // Narrow forms stay narrow, the wide arm starts exactly at 2^32 and below -2^31, and integral doubles
    // past the safe-integer range fall back to float64 rather than wrapping.
    expect(tags.get(2 ** 32 - 1)).toBe(0xce);
    expect(tags.get(2 ** 32)).toBe(0xcf);
    expect(tags.get(-(2 ** 31))).toBe(0xd2);
    expect(tags.get(-(2 ** 31) - 1)).toBe(0xd3);
    expect(tags.get(2 ** 53 - 1)).toBe(0xcf);
    expect(tags.get(2 ** 53)).toBe(0xcb);
    expect(tags.get(-(2 ** 53 - 1))).toBe(0xd3);
    expect(tags.get(-(2 ** 53))).toBe(0xcb);
    for (const value of BOUNDARIES) {
      if (isWide(value)) expect(tags.get(value), `${value}`).toBe(value < 0 ? 0xd3 : 0xcf);
    }
  });

  test("match @std/msgpack and the previous BigInt path at every width boundary", () => {
    for (const value of BOUNDARIES) {
      // The pre-change arm was literally `bigint(BigInt(value))`; narrow and float64 values never took it.
      const widened = isWide(value) ? BigInt(value) : value;
      const actual = encodeL1(value);
      expect(actual, `${value} vs @std/msgpack`).toEqual(encodeReference(widened));
      expect(actual, `${value} vs BigInt path`).toEqual(encode(widened));
    }
  });

  test("match @std/msgpack and the previous BigInt path across 20000 random wide integers", () => {
    expect(RANDOM_WIDE.length).toBeGreaterThan(19_000);
    for (const value of RANDOM_WIDE) {
      const actual = encodeL1(value);
      expect(actual, `${value} vs @std/msgpack`).toEqual(encodeReference(BigInt(value)));
      expect(actual, `${value} vs BigInt path`).toEqual(encode(BigInt(value)));
    }
  });

  test("produce the hand-derived big-endian two's-complement bytes", () => {
    for (const [value, hex] of LITERALS) {
      expect(bytesToHex(encodeL1(value)), `${value}`).toBe(hex);
    }
  });

  test("stay byte-identical at unaligned offsets and across buffer growth", () => {
    // Thousands of 9-byte writes behind a 1-byte header put every value at a different alignment and
    // force the writer's buffer to grow mid-array several times.
    const values = [...BOUNDARIES, ...RANDOM_WIDE.slice(0, 5000)];
    const action = { type: "cancel", cancels: values.map((o, a) => ({ a, o })) };
    const widened = { type: "cancel", cancels: values.map((o, a) => ({ a, o: isWide(o) ? BigInt(o) : o })) };
    expect(encodeL1(action)).toEqual(encodeReference(widened));
  });
});

// --- Hash and signature parity ------------------------------------------------

const PRIVATE_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";
const NONCE = 1700000000000;
const VAULT = "0x1234567890123456789012345678901234567890";
const EXPIRES = 1700000005000;
const ORDER = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } };

/**
 * Representative L1 actions carrying wide integers, with hashes and signatures captured from the
 * pre-change implementation (every wide value went through `BigInt`). Any drift here means a signature
 * the exchange would reject — or worse, accept for a different payload.
 */
const PINNED = [
  {
    name: "cancel with wide order IDs",
    action: {
      type: "cancel",
      cancels: [
        { a: 0, o: 41234567890 },
        { a: 7, o: 4294967296 },
        { a: 110000, o: 2 ** 53 - 1 },
      ],
    },
    hash: "0x0953e0731ae787390ee7c04f1b984f462b3e2639f10230da2a7822dbd236a0e5",
    hashVaultExpiry: "0xf60a2680a480205f3d16646381d2986f7cac57c514e91445f9a8e8ec63c07693",
    mainnet: {
      r: "0xf69451e5f02794784f4f471b1e8af7ac05527daf32df56c63d04f7f0d691bd09",
      s: "0x321e78607fb966f0a0711cb072beb0e77687c6a72826138fab656c5c7ddc2ccd",
      v: 28,
    },
    testnet: {
      r: "0xed6df098c2cd4b11cfe4ccba9a66c7e36060d8a59d6f7bb68f1cd38fe37a65c5",
      s: "0x3915170d2cef0c6846478d8cf165eaef72ebf6eb5f7eb12c1dd4e4c726c18c5f",
      v: 27,
    },
  },
  {
    name: "batchModify with wide and uint32-max order IDs",
    action: {
      type: "batchModify",
      modifies: [
        { oid: 41234567890, order: ORDER },
        { oid: 4294967295, order: ORDER },
      ],
    },
    hash: "0x5f0a455f9441b7005c42e6e64fc33ee215243a025766f9dc05f75766b9a47d6b",
    hashVaultExpiry: "0xf49e09008d073a2c25a269defd7665e94ed099622d14b00d2524181094a9d5e6",
    mainnet: {
      r: "0xa5c49b6da207b73166edb261b41b2daada265624c8614e713d602313d4ab5122",
      s: "0x703a49d4f0883e1c071c1ea01af357ac3c343ee41289b10cc67e12db7cd2c1f2",
      v: 27,
    },
    testnet: {
      r: "0x913dd93befe2767c6fc87e99f8b3e0d27fc3254672775f582d434c3bfec76236",
      s: "0x6c4fb8c82c41e22d9ffdc5c2673a83c6eb0fee837541a9507f0df61c8b373fbd",
      v: 27,
    },
  },
  {
    name: "modify with a wide order ID",
    action: { type: "modify", oid: 98765432109, order: ORDER },
    hash: "0x35d18a1476b5d6c44efa8a9f3e8c12582f2f59bade0c1e00b6889a4442aa404c",
    hashVaultExpiry: "0x7dae78bf7bad383a14cbc9a8765b2940e97ec29036dfb2ebaad70b5aad0c0107",
    mainnet: {
      r: "0x443db2e91799326fc8f138476b80ad1394f2b3a2091425752878eccd797f32f9",
      s: "0x6b403909deada3a617ccf537ec5f609155efe3de2d4319161fca8a5bfd414412",
      v: 27,
    },
    testnet: {
      r: "0x993d05a9f5f15c68c8822625e40030b47325fb9ee4fc57e24c1519b80619a0aa",
      s: "0x7c2121f03a14fc7963f2089bcd682c46ff9eadecd78a88b791999b4db3e141e9",
      v: 27,
    },
  },
  {
    name: "scheduleCancel with a millisecond timestamp",
    action: { type: "scheduleCancel", time: 1700000060000 },
    hash: "0x543d84c42876132614aca907b0dbd95399b942229d79e0f1c5eb81f1592e2ddf",
    hashVaultExpiry: "0x05e127a7058362a50c0866b034a604a6fb38b71aadc61245cf8da7d0896efabb",
    mainnet: {
      r: "0x25bb05400e3b2fa0d30366e3a69cdc27de651c0e5f1a1bd5c7762458966a6a4f",
      s: "0x30e4d29da35a7f390e6cae8f5184195fd64be65b3afa9bf021d24a9f44c03da6",
      v: 27,
    },
    testnet: {
      r: "0x27952106ab6947f5b04f6a0959bb2ecb623316f582b4c30184b8283fb5451a1e",
      s: "0x14b72883a747a0342b1b38eba9fa6f1de7636e3e7b580dcfbc2982613fd6fd5f",
      v: 27,
    },
  },
  {
    name: "twapCancel with a wide TWAP ID",
    action: { type: "twapCancel", a: 3, t: 8589934593 },
    hash: "0x1539cbbb6a7e4a69f15c170a3ce7b7d46cf69e804e6ace414b0767f80d4122dd",
    hashVaultExpiry: "0xa82def8df7e0a9faac60fb1a0bc58e61c1e1a6b671b274f8be40b53d520482a9",
    mainnet: {
      r: "0x9e79fa871866f213f80c94c5082b48643b425226098b716ba8701e1fb4156838",
      s: "0x728ecd3febb2e97c3d46359849576995d3684c17599c4598128c742db62af233",
      v: 28,
    },
    testnet: {
      r: "0x92ca20950864714e28682eae2dd024f6dfbebaed4d5feb0c66010afbb0e3be08",
      s: "0x06f09818d2885a52027297f71480e5e1b23eba4af37274e2b432462e6c22dc05",
      v: 28,
    },
  },
  {
    // Not a shape the exchange sends, but it pins the int64 (two's-complement) arm end to end.
    name: "negative wide integers",
    action: {
      type: "cancel",
      cancels: [
        { a: 0, o: -2147483649 },
        { a: 1, o: -4294967296 },
        { a: 2, o: -(2 ** 53 - 1) },
      ],
    },
    hash: "0x977c82d2c2553cb2a2e7056c296584a3d642ac2a21c6fffdb74654a42f2dee3a",
    hashVaultExpiry: "0xdf3befe107bbc990a5e744192d0f0f8b7546b7d41ab13deb03d538cf00102efc",
    mainnet: {
      r: "0xdcbbfb8263c0fe3804340003082dca1177d100626b2011dc87c9c12ae76f6904",
      s: "0x5aff05c5630e2ddba3c0e442989eff485db6e519161038daa2417529fe0beb70",
      v: 27,
    },
    testnet: {
      r: "0xb693cec4d6c9aaf229b347e75943b5ba2e5b0ee615e57384cdcec4acc484ac26",
      s: "0x4d69c1c1aa1459207f94f15e14b78844b74542a5b2d572f3ed7f0b89374373ef",
      v: 28,
    },
  },
] as const;

describe("L1 actions with wide integers", () => {
  const wallet = privateKeyToAccount(PRIVATE_KEY);

  for (const fixture of PINNED) {
    test(`${fixture.name}: hashes are unchanged`, () => {
      expect(createL1ActionHash({ action: fixture.action, nonce: NONCE })).toBe(fixture.hash);
      expect(
        createL1ActionHash({ action: fixture.action, nonce: NONCE, vaultAddress: VAULT, expiresAfter: EXPIRES }),
      ).toBe(fixture.hashVaultExpiry);
    });

    test(`${fixture.name}: signatures are unchanged`, async () => {
      expect(await signL1Action({ wallet, action: fixture.action, nonce: NONCE })).toEqual(fixture.mainnet);
      expect(await signL1Action({ wallet, action: fixture.action, nonce: NONCE, isTestnet: true })).toEqual(
        fixture.testnet,
      );
    });
  }
});
