/**
 * Differential tests for the fused adjust+encode L1 path (`MsgpackWriter.valueL1` in
 * `src/signing/_msgpack.ts`).
 *
 * `createL1ActionHash` used to normalize the action with `adjust()` (`_l1.ts`) and then encode the
 * result — two walks over the action tree. The encoder now applies the `adjust` rules inline, in a
 * single walk, and the bytes it signs must not move. This file pins that equivalence directly: a
 * verbatim copy of the pre-change `adjust` plus the strict `encode()` serves as the reference
 * oracle, and the fused encoder must reproduce its output byte-for-byte across:
 *
 * 1. a fixed corpus — the SDK's action shapes, `undefined` fields at every level, the
 *    BigInt-widening boundaries (2^53-1, 2^53, 2^63-1, 2^63), integral doubles beyond the
 *    safe-integer range, exotic objects (class instances, `Uint8Array`), null-prototype maps,
 *    inherited enumerable properties, `__proto__` own-key shapes, map-header size boundaries with
 *    dropped keys, and nested multi-sig shapes carrying `preadjustL1Action` markers;
 * 2. throw parity — out-of-range `bigint`s, array holes and `undefined` elements, unencodable
 *    values;
 * 3. a seeded fuzz corpus of 5000 randomized action-shaped trees;
 * 4. the full hash preimage — `createL1ActionHashBytes` against a hand-assembled legacy preimage
 *    (actionBytes ‖ nonce ‖ vault marker+address ‖ expiry marker+value) across vault/expiry
 *    modifiers, including an action whose getter re-enters the hash.
 *
 * Known, deliberate limitation (documented in `_msgpack.ts`): a plain object holding an own
 * enumerable `__proto__` data property AND a sibling that forces `adjust` to rebuild (without an
 * `undefined` at that same level) loses the key under the legacy rebuild's assignment semantics
 * but keeps it under the fused encoder. That shape cannot arise from real actions, and the legacy
 * behavior there already diverges from the exchange's own msgpack, so it is excluded from the
 * corpus. The `__proto__` fixtures below cover every case where the legacy behavior is defined.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexToBytes } from "@noble/hashes/utils.js";

import { createL1ActionHash } from "@bloxwap/hyperliquid/signing";
import { createL1ActionHashBytes, preadjustL1Action } from "../../src/signing/_l1.ts";
import { Adjusted, encode, type L1Value, type MsgpackValue, MsgpackWriter } from "../../src/signing/_msgpack.ts";

// --- Legacy reference: the pre-change two-pass -----------------------------

/** Mirrors the pre-change `ValueType` of `_l1.ts`. */
type ValueType =
  | string
  | number
  | bigint
  | boolean
  | null
  | (Uint8Array & { [key: string]: ValueType })
  | ValueType[]
  | { [key: string]: ValueType };

/**
 * Verbatim copy of the pre-change `adjust()` from `_l1.ts` (the sole cast widens the imported
 * marker's payload type — the class itself moved, unchanged, to `_msgpack.ts`). Frozen here as the
 * reference oracle so the fused encoder stays pinned to the two-pass behavior even if `_l1.ts`'s
 * own `adjust` (still used by `preadjustL1Action`) ever changes.
 */
function legacyAdjust(value: ValueType | Adjusted): ValueType {
  // A subtree already adjusted by `preadjustL1Action` — unwrap it without re-traversing.
  if (value instanceof Adjusted) return value.value as ValueType;
  if (Array.isArray(value)) {
    // Allocate a new array only if some element changes (holes are skipped, like `Array.prototype.map`)
    let changed = false;
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) continue;
      if (legacyAdjust(value[i]) !== value[i]) {
        changed = true;
        break;
      }
    }
    return changed ? value.map(legacyAdjust) : value;
  }
  if (typeof value === "object" && value !== null) {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      let changed = false;
      for (const key of Object.keys(value)) {
        const entry = value[key];
        if (entry === undefined || legacyAdjust(entry) !== entry) {
          changed = true;
          break;
        }
      }
      if (!changed) return value;
    }
    const result: Record<string, ValueType> = {};
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (entry !== undefined) result[key] = legacyAdjust(entry);
    }
    return result;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && (value >= 0x100000000 || value < -0x80000000)) {
    return BigInt(value);
  }
  return value;
}

/** The legacy two-pass: `adjust`, then the strict standalone `encode()`. */
function legacyEncode(action: unknown): Uint8Array {
  return encode(legacyAdjust(action as ValueType) as MsgpackValue);
}

/** The fused single-pass encoder under test. */
function fusedEncode(action: unknown): Uint8Array {
  const writer = new MsgpackWriter();
  writer.valueL1(action as L1Value);
  return writer.view().slice();
}

/** Assembles the legacy hash preimage (two-pass action bytes + suffix) and hashes it with noble. */
function legacyHashBytes(args: {
  action: unknown;
  nonce: number;
  vaultAddress?: `0x${string}`;
  expiresAfter?: number;
}): Uint8Array {
  const actionBytes = legacyEncode(args.action);
  const vault = args.vaultAddress === undefined ? undefined : hexToBytes(args.vaultAddress.slice(2));
  const preimage = new Uint8Array(
    actionBytes.length + 8 + 1 + (vault === undefined ? 0 : 20) + (args.expiresAfter === undefined ? 0 : 9),
  );
  const view = new DataView(preimage.buffer);
  let offset = 0;
  preimage.set(actionBytes, offset);
  offset += actionBytes.length;
  view.setBigUint64(offset, BigInt(args.nonce));
  offset += 8;
  if (vault === undefined) {
    preimage[offset++] = 0;
  } else {
    preimage[offset++] = 1;
    preimage.set(vault, offset);
    offset += 20;
  }
  if (args.expiresAfter !== undefined) {
    preimage[offset++] = 0;
    view.setBigUint64(offset, BigInt(args.expiresAfter));
  }
  return keccak_256(preimage);
}

// --- Fixtures ---------------------------------------------------------------

const NONCE = 1700000000000;
const VAULT = "0x1234567890123456789012345678901234567890" as const;
const EXPIRES = 1700000005000;
const MULTI_SIG_USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const SIGNER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

const ORDER_ACTION = {
  type: "order",
  orders: [{ a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
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
  twap: { a: 0, b: true, s: "0.25", r: false, m: 30, t: true },
} as const;

class ClassAction {
  type = "cancel";
  cancels = [{ a: 0, o: 42 }];
}

/** Class instance carrying an own enumerable `__proto__` data property (defineProperty form). */
function exoticWithProtoKey(): object {
  const value = new ClassAction();
  Object.defineProperty(value, "__proto__", { value: 7, enumerable: true, configurable: true });
  return value;
}

const NULL_PROTO_MAP = Object.create(null) as Record<string, unknown>;
NULL_PROTO_MAP.type = "cancel";
NULL_PROTO_MAP.cancels = [{ a: 0, o: 42 }];
NULL_PROTO_MAP.extra = undefined;

const PROTO_POLLUTED = Object.assign(Object.create({ inherited: "pollution" }) as Record<string, unknown>, {
  type: "cancel",
  cancels: [{ a: 0, o: 42 }],
});

const BIG_MAP_WITH_DROP: Record<string, unknown> = Object.fromEntries(
  Array.from({ length: 65536 }, (_, i) => [`k${i}`, i % 128] as const),
);
BIG_MAP_WITH_DROP.k7 = undefined; // 65536 keys, one dropped: the header shrinks 0xdf -> 0xde

/** Every scalar boundary the two passes branch on. */
const BOUNDARY_NUMBERS: readonly unknown[] = [
  0,
  -0,
  1,
  -1,
  -31,
  -32,
  -33,
  127,
  128,
  255,
  256,
  65535,
  65536,
  2147483647,
  2147483648,
  -128,
  -129,
  -32768,
  -32769,
  -2147483648,
  -2147483649,
  4294967295,
  4294967296,
  1700000000000,
  // BigInt-widening boundaries: widest safe integer (widened), then everything past it (float64).
  2 ** 53 - 1,
  -(2 ** 53 - 1),
  2 ** 53,
  -(2 ** 53),
  2 ** 63 - 1, // === 2**63 in doubles (not representable): integral, not safe — float64 like python
  -(2 ** 63),
  // Integral doubles beyond the safe-integer range: float64 in both passes.
  1e300,
  -1e300,
  Number.MAX_VALUE,
  5e-324,
  1.5,
  -1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

const BOUNDARY_BIGINTS: readonly unknown[] = [
  0n,
  1n,
  -1n,
  127n,
  2n ** 31n,
  2n ** 53n - 1n,
  4294967296n,
  2n ** 63n - 1n,
  -(2n ** 63n),
  2n ** 64n - 1n,
];

const SAMPLE_STRINGS: readonly unknown[] = [
  "",
  "order",
  "Gtc",
  "0.001",
  "0x1234567890123456789012345678901234567890",
  "é",
  "😀",
  "a".repeat(31),
  "a".repeat(32),
  "a".repeat(255),
  "a".repeat(256),
  "before\uD800after",
];

/** `undefined` fields at every level of an action-shaped tree. */
const UNDEFINED_EVERYWHERE = {
  type: "order",
  missing: undefined,
  orders: [
    { a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" }, cloid: undefined } },
    { a: 1, b: false, p: undefined, s: "0.002", r: true, t: { trigger: { isMarket: true, tpsl: "tp" } } },
  ],
  grouping: "na",
  nested: { deep: { deeper: { gone: undefined, kept: 1 } }, also: undefined },
};

const GETTER_ACTION = {
  type: "order",
  get orders(): unknown {
    return ORDER_ACTION.orders.map((order) => ({ ...order, t: { limit: { ...order.t.limit } } }));
  },
  grouping: "na",
};

const GETTER_UNDEFINED_ACTION = {
  type: "scheduleCancel",
  get time(): unknown {
    return undefined;
  },
};

const GETTER_REENTRANT_ACTION = {
  type: "order",
  get orders(): unknown {
    // Re-enters the real hash path mid-encode; the ACTION_WRITER_BUSY guard must isolate it.
    createL1ActionHash({ action: CANCEL_ACTION, nonce: 42 });
    return ORDER_ACTION.orders.map((order) => ({ ...order, t: { limit: { ...order.t.limit } } }));
  },
  grouping: "na",
};

/** Map-header size boundaries crossed by dropped keys. */
const MAP_BOUNDARIES: readonly unknown[] = [
  Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i])),
  Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, i])),
  Object.assign(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, i])), { drop: undefined }),
  Object.assign(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])), {
    d1: undefined,
    d2: undefined,
  }),
  Object.assign(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])), { drop: undefined }),
];

/** Multi-sig inner payloads and outer wrappers, with the pre-adjusted marker in place. */
function multiSigShapes(action: Record<string, unknown> | unknown[]): readonly unknown[] {
  return [
    [MULTI_SIG_USER, SIGNER, preadjustL1Action(action)],
    {
      signatureChainId: "0x66eee",
      signatures: [
        { r: "0x12", s: "0x34", v: 27 },
        { r: "0x56", s: "0x78", v: 28 },
      ],
      payload: { multiSigUser: MULTI_SIG_USER, outerSigner: SIGNER, action: preadjustL1Action(action) },
    },
    { wrapper: { inner: [MULTI_SIG_USER, SIGNER, preadjustL1Action(action)] } },
  ];
}

const CORPUS: readonly unknown[] = [
  // Scalars at the root and nested one level deep.
  ...BOUNDARY_NUMBERS,
  ...BOUNDARY_BIGINTS,
  ...SAMPLE_STRINGS,
  true,
  false,
  null,
  { v: BOUNDARY_NUMBERS },
  BOUNDARY_NUMBERS,
  // The SDK's action shapes.
  ORDER_ACTION,
  CANCEL_ACTION,
  TWAP_ORDER_ACTION,
  { type: "scheduleCancel", time: 1700000060000 },
  { type: "scheduleCancel", time: undefined },
  { type: "scheduleCancel", time: 1e300 },
  { type: "vaultTransfer", vault: VAULT, isDeposit: true, usd: 4294967296 },
  { type: "updateLeverage", asset: 0, isCross: true, leverage: 20 },
  {
    type: "batchModify",
    modifies: [
      { oid: 1234567890, order: { a: 0, b: true, p: "30001", s: "0.002", r: false, t: { limit: { tif: "Alo" } } } },
      { oid: 4294967297, order: { a: 1, b: false, p: "30002", s: "0.003", r: true, t: { limit: { tif: "Ioc" } } } },
    ],
  },
  [{ type: "cancel", cancels: [{ a: 0, o: 42 }] }],
  // `undefined` fields at every level.
  UNDEFINED_EVERYWHERE,
  { a: undefined },
  { a: undefined, b: undefined },
  { a: { b: { c: undefined } }, d: [{ e: undefined }] },
  [{ gone: undefined }, [{ also: undefined, x: [null, { y: undefined, z: 2 }] }]],
  NULL_PROTO_MAP,
  GETTER_UNDEFINED_ACTION,
  // Exotic objects: class instances, typed arrays, prototype pollution, frozen trees.
  new ClassAction(),
  exoticWithProtoKey(),
  PROTO_POLLUTED,
  new Uint8Array(),
  new Uint8Array([1, 2, 3]),
  new Uint8Array(300),
  Object.assign(new Uint8Array([9, 8, 7]), { extra: undefined, named: 5 }),
  { binary: new Uint8Array([1, 2, 3]) },
  Object.freeze({ type: "scheduleCancel", time: 1700000060000 }),
  Object.freeze([Object.freeze({ a: 0, o: 4294967296 })]),
  // Integer-like keys: `Object.keys` orders them numerically in both passes.
  { "2": "b", "1": "a", "10": "c", wide: 2 ** 53 - 1 },
  // Own `__proto__` data properties where the legacy behavior is defined (see module doc).
  JSON.parse('{"__proto__": 5}'),
  Object.assign(JSON.parse('{"__proto__": 5}'), { drop: undefined }),
  // Map-header size boundaries.
  ...MAP_BOUNDARIES,
  BIG_MAP_WITH_DROP,
  // Getters (consistent, and one that re-enters the hash).
  GETTER_ACTION,
  GETTER_REENTRANT_ACTION,
  // Multi-sig shapes with pre-adjusted markers, including a root marker.
  ...multiSigShapes(ORDER_ACTION),
  ...multiSigShapes({ type: "scheduleCancel", time: 1700000060000 }),
  ...multiSigShapes(UNDEFINED_EVERYWHERE as Record<string, unknown>),
  preadjustL1Action(ORDER_ACTION),
  preadjustL1Action([{ type: "cancel", cancels: [{ a: 0, o: 4294967296 }] }]),
];

// --- Throw parity -----------------------------------------------------------

const HOLEY: unknown[] = [];
HOLEY[0] = 1;
HOLEY[2] = 3;

const THROWING: readonly [label: string, value: () => unknown, message: string][] = [
  ["root bigint above uint64", () => 2n ** 64n, "Cannot safely encode bigint larger than 64 bits"],
  ["root bigint below int64", () => -(2n ** 63n) - 1n, "Cannot safely encode bigint larger than 64 bits"],
  [
    "nested bigint outside 64 bits",
    () => ({ type: "x", v: 2n ** 64n }),
    "Cannot safely encode bigint larger than 64 bits",
  ],
  ["root undefined", () => undefined, "Cannot safely encode value into messagepack"],
  ["root function", () => () => 0, "Cannot safely encode value into messagepack"],
  ["root symbol", () => Symbol("s"), "Cannot safely encode value into messagepack"],
  ["nested function", () => ({ type: "order", bad: () => 0 }), "Cannot safely encode value into messagepack"],
  ["array hole", () => HOLEY, "Cannot safely encode value into messagepack"],
  ["array undefined element", () => [1, undefined, 3], "Cannot safely encode value into messagepack"],
];

// --- Seeded fuzz ------------------------------------------------------------

/** xorshift32, so a failure is reproducible rather than a one-off CI flake. */
let randomState = 0x1b873593;

/** Next pseudo-random float in `[0, 1)`. */
function nextRandom(): number {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  randomState |= 0;
  return (randomState >>> 0) / 4294967296;
}

/** Draws uniformly from `choices`. */
function pick<T>(choices: readonly T[]): T {
  return choices[Math.floor(nextRandom() * choices.length)];
}

/** A random scalar: boundary-heavy, with random wide integers and doubles mixed in. */
function randomScalar(): unknown {
  const r = nextRandom();
  if (r < 0.3) return pick(BOUNDARY_NUMBERS);
  if (r < 0.4) return pick(BOUNDARY_BIGINTS);
  if (r < 0.7) return pick(SAMPLE_STRINGS);
  if (r < 0.78) return nextRandom() < 0.5;
  if (r < 0.83) return null;
  if (r < 0.92) return Math.floor(nextRandom() * 2 ** 60) * (nextRandom() < 0.5 ? -1 : 1);
  return nextRandom() * 2e6 - 1e6;
}

/**
 * A random action-shaped tree. Half the draws build generic containers (arrays, maps with dropped
 * `undefined`s, null-prototype maps, typed arrays, `preadjustL1Action` markers); the other half
 * build one of the SDK's action shapes with randomized fields.
 */
function randomActionShape(depth: number): unknown {
  if (depth <= 0) return randomScalar();

  const kind = nextRandom();
  if (kind < 0.12) {
    // order action with a random batch
    const length = Math.floor(nextRandom() * 6);
    return {
      type: "order",
      orders: Array.from({ length }, (_, i) => ({
        a: Math.floor(nextRandom() * 200),
        b: nextRandom() < 0.5,
        p: `${Math.floor(nextRandom() * 100000)}`,
        s: `${nextRandom()}`,
        r: nextRandom() < 0.5,
        t:
          nextRandom() < 0.7
            ? { limit: { tif: pick(["Gtc", "Alo", "Ioc"]) } }
            : {
                trigger: { isMarket: nextRandom() < 0.5, triggerPx: `${nextRandom() * 1e5}`, tpsl: pick(["tp", "sl"]) },
              },
        cloid: nextRandom() < 0.3 ? undefined : `0x${i}${"0".repeat(31)}`,
      })),
      grouping: pick(["na", "normalTpsl", "positionTpsl"]),
      builder: nextRandom() < 0.3 ? undefined : { b: VAULT, f: Math.floor(nextRandom() * 100) },
    };
  }
  if (kind < 0.2) {
    return {
      type: pick(["cancel", "batchModify", "scheduleCancel", "twapOrder", "vaultTransfer", "updateLeverage"]),
      time: pick(BOUNDARY_NUMBERS),
      cancels: [{ a: Math.floor(nextRandom() * 10), o: randomScalar() }],
      missing: nextRandom() < 0.5 ? undefined : randomScalar(),
    };
  }
  if (kind < 0.26) {
    // Multi-sig inner payload / outer wrapper with a pre-adjusted marker.
    const inner = randomActionShape(depth - 1) as Record<string, unknown> | unknown[];
    return nextRandom() < 0.5
      ? [MULTI_SIG_USER, SIGNER, preadjustL1Action(inner)]
      : {
          signatureChainId: "0x66eee",
          signatures: [{ r: "0x12", s: "0x34", v: 27 }],
          payload: { multiSigUser: MULTI_SIG_USER, outerSigner: SIGNER, action: preadjustL1Action(inner) },
        };
  }
  if (kind < 0.55) {
    const length = Math.floor(nextRandom() * 7);
    return Array.from({ length }, () => randomActionShape(depth - 1));
  }

  // Generic map, with dropped `undefined`s and occasional exotic variants.
  const length = Math.floor(nextRandom() * 7);
  const roll = nextRandom();
  const map: Record<string, unknown> = roll < 0.15 ? (Object.create(null) as Record<string, unknown>) : {};
  for (let i = 0; i < length; i++) {
    const key = `${nextRandom() < 0.7 ? "k" : "é"}${i}`;
    map[key] = nextRandom() < 0.12 ? undefined : randomActionShape(depth - 1);
  }
  if (roll >= 0.15 && roll < 0.2) return preadjustL1Action(map);
  return map;
}

// --- Byte-level differential -------------------------------------------------

describe("MsgpackWriter.valueL1() fused adjust+encode", () => {
  test("matches legacy adjust()+encode() across the fixed corpus", () => {
    for (const [index, value] of CORPUS.entries()) {
      expect(fusedEncode(value), `CORPUS[${index}]`).toEqual(legacyEncode(value));
    }
  });

  test("matches legacy adjust()+encode() across 5000 randomized action-shaped trees", () => {
    for (let index = 0; index < 5000; index++) {
      const value = randomActionShape(4);
      expect(fusedEncode(value), `random tree #${index}`).toEqual(legacyEncode(value));
    }
  });

  test("throws the same errors as the two-pass path", () => {
    for (const [label, value, message] of THROWING) {
      expect(() => legacyEncode(value()), `legacy: ${label}`).toThrow(message);
      expect(() => fusedEncode(value()), `fused: ${label}`).toThrow(message);
    }
  });
});

// --- Hash-level differential --------------------------------------------------

const MODIFIERS: readonly { vaultAddress?: `0x${string}`; expiresAfter?: number }[] = [
  {},
  { vaultAddress: VAULT },
  { expiresAfter: EXPIRES },
  { vaultAddress: VAULT, expiresAfter: EXPIRES },
];

describe("createL1ActionHashBytes() fused preimage", () => {
  test("matches the legacy preimage hash across the fixed corpus and modifiers", () => {
    for (const [index, action] of CORPUS.entries()) {
      for (const modifiers of MODIFIERS) {
        const args = { action, nonce: NONCE, ...modifiers };
        expect(
          createL1ActionHashBytes(args as Parameters<typeof createL1ActionHashBytes>[0]),
          `CORPUS[${index}] / ${JSON.stringify(modifiers)}`,
        ).toEqual(legacyHashBytes(args));
      }
    }
  });

  test("matches the legacy preimage hash across 250 randomized actions", () => {
    for (let index = 0; index < 250; index++) {
      const action = randomActionShape(3) as Record<string, unknown> | unknown[];
      for (const modifiers of MODIFIERS) {
        const args = { action, nonce: NONCE, ...modifiers };
        expect(createL1ActionHashBytes(args), `random action #${index} / ${JSON.stringify(modifiers)}`).toEqual(
          legacyHashBytes(args),
        );
      }
    }
  });

  test("keeps byte-equality when a getter re-enters the hash", () => {
    for (const modifiers of MODIFIERS) {
      const args = { action: GETTER_REENTRANT_ACTION, nonce: NONCE, ...modifiers };
      expect(createL1ActionHashBytes(args), JSON.stringify(modifiers)).toEqual(legacyHashBytes(args));
    }
  });
});
