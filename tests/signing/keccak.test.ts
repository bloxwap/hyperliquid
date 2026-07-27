/**
 * Differential conformance tests for the WASM keccak256 provider.
 *
 * `src/signing/_keccak.ts` swaps noble's pure-JS `keccak_256` for `hash-wasm`'s WASM keccak on
 * every hash the L1 signing path runs — the action preimage plus the two Agent-digest hashes —
 * and a single differing byte would authorize a payload the user never approved. So noble is kept
 * as the oracle here: across empty/one-byte inputs, the keccak block boundary (the rate is 136
 * bytes), the exact preimages of the perf-suite order actions, the profiler's 130-byte and
 * 4434-byte shapes, and seeded fuzz, the WASM digest must be byte-identical to noble's — and the
 * final signature must be identical whichever provider ran.
 *
 * Both provider states are pinned: WASM loaded (real loader) and forced fallback (loader
 * resolving `undefined`, a hasher failing the known-answer self-check, a rejected loader, and
 * the not-yet-loaded window) all keep producing the noble-correct bytes. Fallback simulation
 * goes through `_setKeccakLoaderForTests`, not module mocking: a mocked specifier stays poisoned
 * for the rest of the process and an already-cached real module shadows the mock, so under
 * `bun test` which path ran would depend on test-file order. The suite passes with or without
 * the optional `hash-wasm` package installed — byte-identity holds either way; the tests that
 * need the real module are gated on a probe, like the perf scenarios.
 * @module
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { privateKeyToAccount } from "viem/accounts";

import {
  type AbstractViemLocalAccount,
  createFastLocalWallet,
  createL1ActionHash,
  signL1Action,
} from "@bloxwap/hyperliquid/signing";
import {
  type DigestBytesCapable,
  SIGN_DIGEST_BYTES,
  signRawDigest,
  signRawDigestBytes,
} from "../../src/signing/_abstractWallet.ts";
import { createL1AgentDigest, createL1AgentDigestBytes } from "../../src/signing/_fastDigest.ts";
import { _setKeccakLoaderForTests, keccak256, preloadWasmKeccak } from "../../src/signing/_keccak.ts";
import { createL1ActionHashBytes } from "../../src/signing/_l1.ts";
import { MsgpackWriter } from "../../src/signing/_msgpack.ts";

// --- Optional-dependency probes (same pattern as the perf scenarios) ---------

const hashWasmAvailable = await import("hash-wasm").then(
  () => true,
  () => false,
);
const tinySecp256k1Available = await import("tiny-secp256k1").then(
  () => true,
  () => false,
);

// --- Fixtures (same shapes as tests/signing/fastDigest.test.ts) --------------

const PRIVATE_KEYS = [
  "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

const NONCE = 1700000000000;
const VAULT = "0x1234567890123456789012345678901234567890" as const;
const EXPIRES = 1700000005000;

const ORDER_WITH_CLOID = {
  type: "order",
  orders: [
    {
      a: 0,
      b: true,
      p: "30000",
      s: "0.001",
      r: false,
      t: { limit: { tif: "Gtc" } },
      c: "0x1234567890abcdef1234567890abcdef",
    },
  ],
  grouping: "na",
} as const;

const CANCEL = { type: "cancel", cancels: [{ a: 0, o: 1234567890 }] } as const;
const SCHEDULE_CANCEL = { type: "scheduleCancel", time: 1700000060000 } as const;

/** The order shapes the perf suite hashes (`tests/perf/scenarios/signing.ts`). */
function perfOrder(i: number): Record<string, unknown> {
  return { a: i % 200, b: i % 2 === 0, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } };
}

/** Every combination of action x hash modifiers the signature cross-check runs over. */
const CASES: readonly { label: string; action: Record<string, unknown>; vault?: `0x${string}`; expires?: number }[] = [
  { label: "order with cloid", action: ORDER_WITH_CLOID },
  { label: "order with cloid + vault + expiry", action: ORDER_WITH_CLOID, vault: VAULT, expires: EXPIRES },
  { label: "cancel", action: CANCEL },
  { label: "scheduleCancel", action: SCHEDULE_CANCEL },
];

/** keccak-256 of the empty input. */
const KECCAK256_EMPTY = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

/** The known-answer L1 action hash pinned by tests/signing/fastDigest.test.ts and msgpack.test.ts. */
const ORDER_ACTION_HASH = "0x124a730fa73e0369fa3cb2183bc6cce521491bee320b80d4b7a2062dd0f11578";

/** The known-answer Agent digests pinned by tests/signing/fastDigest.test.ts (captured from viem). */
const AGENT_ACTION_HASH = "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d" as const;
const AGENT_DIGEST_MAINNET = "0xcf97446596762e207bece6115520a233d4cec3c8f22c5193a633baa610233d8e";
const AGENT_DIGEST_TESTNET = "0x9e83d71366d4323b7c4830d17c68f71fb730ce3b2edf19e5110c0712140c9931";

/**
 * Rebuilds the exact preimage `createL1ActionHashBytes` hashes: the msgpack action, the u64
 * nonce, and the vault/expiry markers, in wire order. These actions need no `adjust`
 * normalization (plain objects, small integers), so the writer sees them as-is.
 */
function l1Preimage(action: unknown, nonce: number, vault?: `0x${string}`, expires?: number): Uint8Array {
  const writer = new MsgpackWriter();
  writer.value(action as never);
  writer.uint64(nonce);
  if (vault) {
    writer.byte(1);
    writer.raw(hexToBytes(vault.slice(2)));
  } else {
    writer.byte(0);
  }
  if (expires !== undefined) {
    writer.byte(0);
    writer.uint64(expires);
  }
  // `view()` aliases the writer's buffer — copy before the writer can be reused.
  return writer.view().slice();
}

/** Deterministic PRNG (mulberry32) so the fuzz vectors are reproducible run to run. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

afterEach(() => {
  // Restore the real loader (and the unloaded provider state) whatever a test did.
  _setKeccakLoaderForTests(undefined);
});

// --- The shared byte-identity suite, run under each provider state ------------

/**
 * Registers the vector suite once per provider state. Every expectation pins byte-identity with
 * noble's `keccak_256` (and with the known-answer literals the rest of the suite captured), so a
 * state passes only if its provider produces exactly the noble bytes.
 */
function pinByteIdentity(): void {
  test("keccak256() matches noble across sizes and the 136-byte block boundary", () => {
    // keccak-256's rate is 136 bytes: 135/136/137 straddle the one-block boundary, 271/272/273
    // the two-block one; 130 and 4434 are the profiler's order_1/order_100 preimage shapes.
    const sizes = [0, 1, 31, 32, 63, 64, 130, 134, 135, 136, 137, 138, 271, 272, 273, 4434];
    for (const size of sizes) {
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = (i * 31 + size) & 0xff;
      expect(bytesToHex(keccak256(data)), `size ${size}`).toBe(bytesToHex(keccak_256(data)));
    }
  });

  test("keccak256() matches noble on seeded fuzz (256 inputs, 0-1500 bytes)", () => {
    const rand = mulberry32(0x2f6e2b1);
    for (let i = 0; i < 256; i++) {
      const data = new Uint8Array(Math.floor(rand() * 1500));
      for (let j = 0; j < data.length; j++) data[j] = Math.floor(rand() * 256);
      expect(bytesToHex(keccak256(data)), `fuzz ${i} (${data.length}B)`).toBe(bytesToHex(keccak_256(data)));
    }
  });

  test("keccak256() matches noble on the exact L1 action preimages", () => {
    const oneOrder = { type: "order", orders: [perfOrder(0)], grouping: "na" };
    const hundredOrders = {
      type: "order",
      orders: Array.from({ length: 100 }, (_, i) => perfOrder(i)),
      grouping: "na",
    };

    // The shapes the L1 path really hashes; the lengths are pinned so a fixture edit shows up here.
    const cases = [
      { label: "perf order_1", preimage: l1Preimage(oneOrder, NONCE), length: 85 },
      { label: "perf order_100", preimage: l1Preimage(hundredOrders, NONCE), length: 4443 },
      { label: "order with cloid", preimage: l1Preimage(ORDER_WITH_CLOID, NONCE), length: 123 },
      {
        label: "order with cloid + vault + expiry",
        preimage: l1Preimage(ORDER_WITH_CLOID, NONCE, VAULT, EXPIRES),
        length: 152,
      },
    ];
    for (const { label, preimage, length } of cases) {
      expect(preimage.length, `${label} length`).toBe(length);
      expect(bytesToHex(keccak256(preimage)), label).toBe(bytesToHex(keccak_256(preimage)));
    }
  });

  test("createL1ActionHash() / createL1AgentDigest() keep their known-answer pins", () => {
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
    expect(createL1AgentDigest(AGENT_ACTION_HASH, false)).toBe(AGENT_DIGEST_MAINNET);
    expect(createL1AgentDigest(AGENT_ACTION_HASH, true)).toBe(AGENT_DIGEST_TESTNET);
  });

  test("the *Bytes variants agree with the hex API byte-for-byte", () => {
    expect(bytesToHex(createL1ActionHashBytes({ action: ORDER_WITH_CLOID, nonce: NONCE }))).toBe(
      ORDER_ACTION_HASH.slice(2),
    );
    for (const isTestnet of [false, true]) {
      expect(bytesToHex(createL1AgentDigestBytes(hexToBytes(AGENT_ACTION_HASH.slice(2)), isTestnet))).toBe(
        createL1AgentDigest(AGENT_ACTION_HASH, isTestnet).slice(2),
      );
    }
  });

  test("keccak256() reuses the WASM hasher correctly across sequential calls", () => {
    // A stateful hasher that fails to reset between init/update/digest cycles shows up here:
    // the same input must re-hash to the same bytes after different inputs intervened.
    const a = bytesToHex(keccak256(new Uint8Array(130).fill(0x11)));
    bytesToHex(keccak256(new Uint8Array(4434).fill(0x22)));
    bytesToHex(keccak256(new Uint8Array(0)));
    expect(bytesToHex(keccak256(new Uint8Array(130).fill(0x11)))).toBe(a);
    expect(a).toBe(bytesToHex(keccak_256(new Uint8Array(130).fill(0x11))));
  });
}

// --- Provider states ----------------------------------------------------------

describe("keccak256() forced fallback (loader resolves undefined)", () => {
  beforeEach(() => {
    _setKeccakLoaderForTests(() => Promise.resolve(undefined));
  });
  pinByteIdentity();
});

describe("keccak256() real loader (WASM when hash-wasm is installed)", () => {
  beforeEach(async () => {
    _setKeccakLoaderForTests(undefined);
    await preloadWasmKeccak();
  });
  pinByteIdentity();
});

// --- Load semantics -------------------------------------------------------------

describe("keccak256() load semantics", () => {
  test("serves noble bytes until the load settles, then identical bytes from the loaded provider", async () => {
    // A noble-backed stand-in for the WASM module, so the not-yet-loaded semantics are pinned
    // without depending on the optional package (the real module is covered by the suites above).
    const nobleBackedHasher = {
      state: keccak_256.create(),
      init() {
        this.state = keccak_256.create();
      },
      update(data: Uint8Array) {
        this.state.update(data);
      },
      digest(_outputType: "binary"): Uint8Array {
        return this.state.digest();
      },
    };

    // Deferred loader: the first hash kicks the load, but it cannot settle until the test says so.
    let loads = 0;
    let release: (hasher: typeof nobleBackedHasher) => void = () => {};
    _setKeccakLoaderForTests(
      () =>
        new Promise((resolve) => {
          loads++;
          release = resolve;
        }),
    );

    // Not yet loaded: the sync API never blocks on the async init — noble answers immediately.
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
    expect(loads).toBe(1); // a burst of hashes dedupes onto one in-flight load

    release(nobleBackedHasher);
    await preloadWasmKeccak();

    // Loaded: identical bytes, now served through the provider dispatch.
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
    expect(loads).toBe(1);
  });

  test("a rejected loader leaves the dispatch on noble without throwing", async () => {
    _setKeccakLoaderForTests(() => Promise.reject(new Error("boom")));

    // The sync path must not surface the async failure, now or after it settles.
    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(KECCAK256_EMPTY);
    await preloadWasmKeccak();
    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(KECCAK256_EMPTY);
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
  });

  test("a hasher failing the known-answer self-check is never trusted", async () => {
    _setKeccakLoaderForTests(() =>
      Promise.resolve({
        init() {},
        update() {},
        // keccak-256 of the empty input is never all-zero: validation must reject this.
        digest: (_outputType: "binary") => new Uint8Array(32),
      }),
    );
    await preloadWasmKeccak();

    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(KECCAK256_EMPTY);
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
  });

  test("a hasher that throws during the self-check is never trusted", async () => {
    _setKeccakLoaderForTests(() =>
      Promise.resolve({
        init() {
          throw new Error("broken WASM build");
        },
        update() {},
        digest: (_outputType: "binary") => new Uint8Array(32),
      }),
    );
    await preloadWasmKeccak();

    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(KECCAK256_EMPTY);
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
  });

  test("a partially linked module (missing createKeccak) falls back to noble", async () => {
    _setKeccakLoaderForTests(() => Promise.resolve(undefined));
    await preloadWasmKeccak();

    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(KECCAK256_EMPTY);
  });
});

// The real WASM module, engaged end-to-end — requires the optional dependency.
if (hashWasmAvailable) {
  describe("keccak256() with hash-wasm installed", () => {
    test("loads the real module exactly once and validates it", async () => {
      let loads = 0;
      _setKeccakLoaderForTests(async () => {
        loads++;
        const { createKeccak } = await import("hash-wasm");
        return createKeccak(256);
      });

      keccak256(new Uint8Array(0));
      keccak256(new Uint8Array(0));
      await preloadWasmKeccak();

      expect(loads).toBe(1);
      expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(KECCAK256_EMPTY);
    });
  });

  describe("loadWasmKeccak() with an unreadable hash-wasm entry", () => {
    test("the real loader routes a failed import to the noble fallback", async () => {
      // Hiding the package's entry file makes the real loader's dynamic import reject — the one
      // loader-failure path `_setKeccakLoaderForTests` cannot reach (it replaces the loader), and
      // module mocking cannot simulate (a mocked specifier stays poisoned for the process — see
      // the module header). hash-wasm ships CJS, so forcing a re-read only takes dropping the
      // `require.cache` record; the file is restored in `finally` and the failed load leaves no
      // cache entry behind, so the real module loads again on the next import.
      const nodeRequire = createRequire(import.meta.url);
      const entry = nodeRequire.resolve("hash-wasm");
      const hidden = `${entry}.hidden-by-test`;
      delete nodeRequire.cache[entry];
      await rename(entry, hidden);
      try {
        // The failure must be real — if a future runtime serves the import from an immutable
        // module cache instead, this test covers nothing and must say so.
        const served = await import("hash-wasm").then(
          () => true,
          () => false,
        );
        expect(served).toBe(false);

        _setKeccakLoaderForTests(undefined); // the real loader — its import now rejects
        await preloadWasmKeccak();

        expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(KECCAK256_EMPTY);
        expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(ORDER_ACTION_HASH);
      } finally {
        await rename(hidden, entry);
        delete nodeRequire.cache[entry]; // drop any failed-load record so the real module re-loads
      }
    });
  });
}

// --- Cross-provider signature identity ------------------------------------------

describe("signL1Action() across keccak providers", () => {
  test("signatures are byte-identical whether noble or WASM hashed", async () => {
    for (const privateKey of PRIVATE_KEYS) {
      const wallet = privateKeyToAccount(privateKey);
      for (const { label, action, vault, expires } of CASES) {
        for (const isTestnet of [false, true]) {
          const args = {
            action: { ...action },
            nonce: NONCE,
            isTestnet,
            vaultAddress: vault,
            expiresAfter: expires,
          };

          _setKeccakLoaderForTests(() => Promise.resolve(undefined));
          const nobleSigned = await signL1Action({ wallet, ...args });

          _setKeccakLoaderForTests(undefined);
          await preloadWasmKeccak();
          const dispatched = await signL1Action({ wallet, ...args });

          const context = `${privateKey.slice(0, 10)} / ${label} / ${isTestnet ? "testnet" : "mainnet"}`;
          expect(dispatched, context).toEqual(nobleSigned);
        }
      }
    }
  });
});

// --- Bytes-level handoff ------------------------------------------------------------

describe("bytes-level hash-digest-wallet handoff", () => {
  test("signL1Action() prefers the wallet's SIGN_DIGEST_BYTES capability over hex sign", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    let bytesCalls = 0;
    let hexCalls = 0;
    const seen: Uint8Array[] = [];
    const wallet: AbstractViemLocalAccount & DigestBytesCapable = {
      address: account.address,
      sign: (args) => {
        hexCalls++;
        return account.sign(args);
      },
      [SIGN_DIGEST_BYTES]: async (digest) => {
        bytesCalls++;
        seen.push(digest);
        return account.sign({ hash: `0x${bytesToHex(digest)}` });
      },
      signTypedData: (params) => account.signTypedData(params),
    };

    const signature = await signL1Action({ wallet, action: { ...CANCEL }, nonce: NONCE });

    expect(bytesCalls).toBe(1);
    expect(hexCalls).toBe(0);
    // The capability received exactly the Agent digest bytes the internal chain computes —
    // the action hash and the digest crossed the whole path without a hex round trip.
    expect(bytesToHex(seen[0])).toBe(
      bytesToHex(createL1AgentDigestBytes(createL1ActionHashBytes({ action: CANCEL, nonce: NONCE }), false)),
    );
    // And the result is byte-identical to signing through the plain hex path.
    expect(signature).toEqual(await signL1Action({ wallet: account, action: { ...CANCEL }, nonce: NONCE }));
  });

  test("a hex-only wallet still signs byte-identically (adapter converts at the boundary)", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    let hexCalls = 0;
    const wallet: AbstractViemLocalAccount = {
      address: account.address,
      sign: (args) => {
        hexCalls++;
        return account.sign(args);
      },
      signTypedData: (params) => account.signTypedData(params),
    };

    const signature = await signL1Action({ wallet, action: { ...CANCEL }, nonce: NONCE });

    expect(hexCalls).toBe(1);
    expect(signature).toEqual(await signL1Action({ wallet: account, action: { ...CANCEL }, nonce: NONCE }));
  });
});

// The fast wallet's own bytes capability — requires the other optional dependency.
if (tinySecp256k1Available) {
  describe("createFastLocalWallet() SIGN_DIGEST_BYTES capability", () => {
    test("matches its own hex sign() byte-for-byte", async () => {
      const fast = (await createFastLocalWallet(PRIVATE_KEYS[0])) as AbstractViemLocalAccount & DigestBytesCapable;
      const signBytes = fast[SIGN_DIGEST_BYTES];
      expect(typeof signBytes).toBe("function");

      const digest = hexToBytes("3333333333333333333333333333333333333333333333333333333333333333");
      expect(await signBytes!(digest)).toBe(await fast.sign!({ hash: `0x${bytesToHex(digest)}` }));
    });
  });
}

// --- Lazy agent digest -----------------------------------------------------------------

describe("signRawDigestBytes() lazy digest", () => {
  const DIGEST_HEX = `0x${"11".repeat(32)}` as const;

  test("never invokes the digest thunk for a wallet without raw-digest capability", async () => {
    let digestCalls = 0;
    // JSON-RPC shape: signTypedData + getAddresses + getChainId — and no local `sign`.
    const wallet = {
      signTypedData: (_params: never) => Promise.resolve(`0x${"22".repeat(64)}1b` as const),
      getAddresses: () => Promise.resolve(["0x1111111111111111111111111111111111111111" as const]),
      getChainId: () => Promise.resolve(1337),
    };

    const result = await signRawDigestBytes({
      wallet,
      digest: () => {
        digestCalls++;
        return hexToBytes(DIGEST_HEX.slice(2));
      },
    });

    // The capability check comes first: a JSON-RPC wallet never pays for the discarded digest.
    expect(result).toBeUndefined();
    expect(digestCalls).toBe(0);
  });

  test("invokes the thunk once for a capable wallet and matches hex signRawDigest", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    let digestCalls = 0;

    const fromBytes = await signRawDigestBytes({
      wallet: account,
      digest: () => {
        digestCalls++;
        return hexToBytes(DIGEST_HEX.slice(2));
      },
    });
    const fromHex = await signRawDigest({ wallet: account, digest: DIGEST_HEX });

    expect(digestCalls).toBe(1);
    expect(fromBytes).toEqual(fromHex);
  });
});
