/**
 * Differential conformance tests for the private-key wallet (`src/signing/_privateKeyWallet.ts`).
 *
 * A raw 32-byte hex key passed as `ExchangeSingleWalletConfig.wallet` is carried by an opaque
 * object whose signer picks a backend lazily: WASM `tiny-secp256k1` after a shape check and a
 * known-answer self-test, else pure-JS `@noble/curves`, silently. Both backends are RFC 6979 +
 * low-S, so the signature authorizes real orders and viem is kept as the oracle: across seeded
 * random keys x mainnet/testnet x actions, the carrier's final signature (r, s, v) must be
 * byte-identical to `privateKeyToAccount`, on BOTH backends. The fallback arms (missing, broken,
 * or wrong-signing WASM module), invalid keys, the `signTypedData` delegation, and the
 * `ExchangeClient` integration are pinned the same way.
 *
 * Fallback simulation goes through `_setPrivateKeyBackendLoaderForTests`, not module mocking — see
 * `tests/signing/fastWallet.test.ts` for why module mocking is not an option under `bun test`.
 * @module
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { privateKeyToAccount } from "viem/accounts";

import { type CoinOrderParameters, ExchangeClient } from "@bloxwap/hyperliquid";
import { ApproveAgentTypes, UsdSendTypes, Withdraw3Types } from "@bloxwap/hyperliquid/api/exchange";
import {
  AbstractWalletError,
  getWalletAddress,
  signL1Action,
  signUserSignedAction,
  warmupSigning,
} from "@bloxwap/hyperliquid/signing";
import {
  _privateKeyWalletBackend,
  _setPrivateKeyBackendLoaderForTests,
  createPrivateKeyWallet,
  isPrivateKeyString,
  preloadPrivateKeyWallet,
} from "../../src/signing/_privateKeyWallet.ts";
import { FIXED_NONCE, LIMIT_ORDER, recordingTransport } from "../api/exchange/_mockTransport.ts";

// --- Fixtures ---------------------------------------------------------------

/** The well-known test key (unfunded; also the KAT key of the WASM self-check). */
const WELL_KNOWN_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";

/** secp256k1 group order: the smallest scalar that is NOT a valid private key. */
const CURVE_ORDER = "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";

/** Deterministic PRNG (mulberry32) so the 50-key corpus is stable across runs and machines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 50 deterministic in-range private keys (rejection-sampled against the curve order). */
const RANDOM_KEYS: `0x${string}`[] = (() => {
  const rand = mulberry32(0x5eed);
  const keys: `0x${string}`[] = [];
  while (keys.length < 50) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(rand() * 256);
    if (!secp256k1.utils.isValidSecretKey(bytes)) continue;
    keys.push(`0x${bytesToHex(bytes)}`);
  }
  return keys;
})();

const NONCE = 1700000000000;
const VAULT = "0x1234567890123456789012345678901234567890" as const;
const EXPIRES = 1700000005000;

const ORDER_SINGLE = {
  type: "order",
  orders: [{ a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
} as const;
const ORDER_BATCH = {
  type: "order",
  orders: [
    { a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } },
    { a: 4, b: false, p: "31000", s: "0.002", r: true, t: { limit: { tif: "Alo" } } },
  ],
  grouping: "na",
} as const;
const CANCEL = { type: "cancel", cancels: [{ a: 0, o: 1234567890 }] } as const;

/** Representative L1 actions: single/batch orders, hash modifiers, and a small fixed shape. */
const L1_CASES: readonly { label: string; action: Record<string, unknown>; vault?: `0x${string}`; expires?: number }[] =
  [
    { label: "order", action: ORDER_SINGLE },
    { label: "order batch", action: ORDER_BATCH },
    { label: "order + vault", action: ORDER_SINGLE, vault: VAULT },
    { label: "order + expiry", action: ORDER_SINGLE, expires: EXPIRES },
    { label: "order + vault + expiry", action: ORDER_SINGLE, vault: VAULT, expires: EXPIRES },
    { label: "cancel", action: CANCEL },
    { label: "cancel + vault", action: CANCEL, vault: VAULT },
  ];

/** Representative user-signed actions, built on the SDK's own EIP-712 type constants. */
const USER_SIGNED_CASES = [
  {
    label: "approveAgent",
    types: ApproveAgentTypes,
    action: {
      type: "approveAgent",
      signatureChainId: "0x66eee",
      hyperliquidChain: "Testnet",
      agentAddress: "0x0000000000000000000000000000000000000001",
      agentName: "Agent",
      nonce: NONCE,
    },
  },
  {
    label: "usdSend",
    types: UsdSendTypes,
    action: {
      type: "usdSend",
      signatureChainId: "0x66eee",
      hyperliquidChain: "Testnet",
      destination: "0x0000000000000000000000000000000000000001",
      amount: "1.5",
      time: NONCE,
    },
  },
  {
    label: "withdraw3",
    types: Withdraw3Types,
    action: {
      type: "withdraw3",
      signatureChainId: "0x66eee",
      hyperliquidChain: "Mainnet",
      destination: "0x0000000000000000000000000000000000000001",
      amount: "2",
      time: NONCE,
    },
  },
] as const;

/** Creates one carrier per backend for the same key: real loader (WASM) and forced fallback (JS). */
async function bothBackends(privateKey: `0x${string}`): Promise<{ wasm: unknown; js: unknown; oracle: unknown }> {
  const wasm = createPrivateKeyWallet(privateKey);
  // Settle the WASM carrier's initializer BEFORE swapping the loader: init is lazy, so awaiting
  // it after the swap would initialize it with the fallback loader.
  expect(await _privateKeyWalletBackend(wasm as never), "wasm backend").toBe("wasm");
  _setPrivateKeyBackendLoaderForTests(() => Promise.resolve(undefined));
  try {
    const js = createPrivateKeyWallet(privateKey);
    expect(await _privateKeyWalletBackend(js as never), "js backend").toBe("js");
    return { wasm, js, oracle: privateKeyToAccount(privateKey) };
  } finally {
    _setPrivateKeyBackendLoaderForTests(undefined);
  }
}

afterEach(() => {
  // Restore the real loader whatever a test did.
  _setPrivateKeyBackendLoaderForTests(undefined);
});

// --- Byte identity -----------------------------------------------------------

describe("private key wallet byte-identity with viem", () => {
  test("signL1Action(): carrier (WASM) == carrier (JS) == viem across 50 keys x actions x networks", async () => {
    for (const privateKey of RANDOM_KEYS) {
      const { wasm, js, oracle } = await bothBackends(privateKey);
      for (const { label, action, vault, expires } of L1_CASES) {
        for (const isTestnet of [false, true]) {
          const args = {
            action: { ...action },
            nonce: NONCE,
            isTestnet,
            vaultAddress: vault,
            expiresAfter: expires,
          };
          const context = `${privateKey.slice(0, 10)} / ${label} / ${isTestnet ? "testnet" : "mainnet"}`;
          const expected = await signL1Action({ wallet: oracle as never, ...args });
          expect(await signL1Action({ wallet: wasm as never, ...args }), `wasm ${context}`).toEqual(expected);
          expect(await signL1Action({ wallet: js as never, ...args }), `js ${context}`).toEqual(expected);
        }
      }
    }
  });

  test("signUserSignedAction(): carrier (WASM) == carrier (JS) == viem across keys x action types", async () => {
    for (const privateKey of RANDOM_KEYS) {
      const { wasm, js, oracle } = await bothBackends(privateKey);
      for (const { label, action, types } of USER_SIGNED_CASES) {
        const args = { action: { ...action }, types };
        const context = `${privateKey.slice(0, 10)} / ${label}`;
        const expected = await signUserSignedAction({ wallet: oracle as never, ...args });
        expect(await signUserSignedAction({ wallet: wasm as never, ...args }), `wasm ${context}`).toEqual(expected);
        expect(await signUserSignedAction({ wallet: js as never, ...args }), `js ${context}`).toEqual(expected);
      }
    }
  });

  test("getWalletAddress(): lowercase, and equal to viem on both backends", async () => {
    for (const privateKey of RANDOM_KEYS) {
      const { wasm, js, oracle } = await bothBackends(privateKey);
      const expected = (oracle as { address: string }).address.toLowerCase() as `0x${string}`;
      expect(await getWalletAddress(wasm as never), privateKey.slice(0, 10)).toBe(expected);
      expect(await getWalletAddress(js as never), privateKey.slice(0, 10)).toBe(expected);
    }
  });

  test("chain ID defaults to 0x1, like a viem local account", async () => {
    const { getWalletChainId } = await import("@bloxwap/hyperliquid/signing");
    const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY);
    expect(await getWalletChainId(carrier)).toBe("0x1");
  });
});

// --- signTypedData delegation ------------------------------------------------

describe("private key wallet signTypedData delegation", () => {
  test("an action the hand-rolled digest cannot encode (checksummed address) still matches viem", async () => {
    // The hand-rolled encoder requires lowercase hex, so a valid EIP-55 checksummed address yields
    // no digest and signing falls through to the signTypedData delegation — a viem local account
    // created from the key. (viem rejects INVALID checksums itself, so the fixture is a real one.)
    const checksummed = privateKeyToAccount(WELL_KNOWN_KEY).address;
    const action = {
      type: "approveAgent",
      signatureChainId: "0x66eee",
      hyperliquidChain: "Testnet",
      agentAddress: checksummed,
      agentName: "Agent",
      nonce: NONCE,
    } as const;
    for (const backend of ["wasm", "js"] as const) {
      if (backend === "js") _setPrivateKeyBackendLoaderForTests(() => Promise.resolve(undefined));
      try {
        const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY);
        const signed = await signUserSignedAction({ wallet: carrier, action: { ...action }, types: ApproveAgentTypes });
        const expected = await signUserSignedAction({
          wallet: privateKeyToAccount(WELL_KNOWN_KEY),
          action: { ...action },
          types: ApproveAgentTypes,
        });
        expect(signed, backend).toEqual(expected);
      } finally {
        _setPrivateKeyBackendLoaderForTests(undefined);
      }
    }
  });
});

// --- Fallback arms ------------------------------------------------------------

describe("private key wallet WASM fallback", () => {
  /** A module with the right shape whose signatures are wrong: the KAT must reject it. */
  const wrongSignatureModule = {
    isPrivate: () => true,
    pointFromScalar: () => new Uint8Array(65),
    signRecoverable: () => ({ signature: new Uint8Array(64), recoveryId: 0 }),
  };

  const FALLBACK_LOADERS = {
    "loader resolves undefined": () => Promise.resolve(undefined),
    "loader rejects": () => Promise.reject(new Error("Cannot find module")),
    "wrong shape (missing isPrivate)": () =>
      Promise.resolve({ signRecoverable: () => ({}), pointFromScalar: () => new Uint8Array(65) }),
    "KAT mismatch": () => Promise.resolve(wrongSignatureModule),
    "KAT throws": () =>
      Promise.resolve({
        ...wrongSignatureModule,
        signRecoverable: () => {
          throw new Error("broken WASM");
        },
      }),
  } as const;

  for (const [label, loader] of Object.entries(FALLBACK_LOADERS)) {
    test(`${label}: backend "js", signature still matches viem, no console.warn`, async () => {
      _setPrivateKeyBackendLoaderForTests(loader);
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY);
        expect(await _privateKeyWalletBackend(carrier)).toBe("js");
        expect(warn).not.toHaveBeenCalled();

        const args = { action: { ...CANCEL }, nonce: NONCE, isTestnet: true } as const;
        expect(await signL1Action({ wallet: carrier, ...args })).toEqual(
          await signL1Action({ wallet: privateKeyToAccount(WELL_KNOWN_KEY), ...args }),
        );
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  }

  test("the default loader settles on the WASM backend (tiny-secp256k1 installed)", async () => {
    const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY);
    expect(await _privateKeyWalletBackend(carrier)).toBe("wasm");
  });

  test("a wallet created before the loader swap keeps its settled backend", async () => {
    const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY);
    expect(await _privateKeyWalletBackend(carrier)).toBe("wasm");
    _setPrivateKeyBackendLoaderForTests(() => Promise.resolve(undefined));
    expect(await _privateKeyWalletBackend(carrier)).toBe("wasm");
  });

  test("preloadPrivateKeyWallet() triggers init without signing and resolves on the fallback too", async () => {
    const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY);
    await preloadPrivateKeyWallet(carrier);
    expect(await _privateKeyWalletBackend(carrier)).toBe("wasm");

    _setPrivateKeyBackendLoaderForTests(() => Promise.resolve(undefined));
    const fallback = createPrivateKeyWallet(WELL_KNOWN_KEY);
    await preloadPrivateKeyWallet(fallback);
    expect(await _privateKeyWalletBackend(fallback)).toBe("js");
  });
});

// --- Invalid inputs -----------------------------------------------------------

describe("private key wallet invalid inputs", () => {
  test("isPrivateKeyString(): false for non-strings, throws for malformed strings without echoing the key", () => {
    expect(isPrivateKeyString(undefined)).toBe(false);
    expect(isPrivateKeyString(null)).toBe(false);
    expect(isPrivateKeyString(123)).toBe(false);
    expect(isPrivateKeyString({ address: "0x0" })).toBe(false);
    expect(isPrivateKeyString(WELL_KNOWN_KEY)).toBe(true);

    for (const bad of [
      "0x1234", // too short
      WELL_KNOWN_KEY.slice(2), // missing 0x
      `${WELL_KNOWN_KEY}ff`, // too long
      "0xZZ34567890abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // non-hex
    ]) {
      let caught: unknown;
      try {
        isPrivateKeyString(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught, bad.slice(0, 8)).toBeInstanceOf(AbstractWalletError);
      expect((caught as Error).message).toContain("32-byte hex private key");
      expect((caught as Error).message.includes(bad)).toBe(false);
    }
  });

  test("createPrivateKeyWallet() throws synchronously on a malformed string, without echoing the key", () => {
    const bad = "0xdeadbeef";
    let caught: unknown;
    try {
      createPrivateKeyWallet(bad as `0x${string}`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AbstractWalletError);
    expect((caught as Error).message).toContain("32-byte hex private key");
    expect((caught as Error).message.includes(bad)).toBe(false);
  });

  test("out-of-range scalars reject on the first signing call, on both backends", async () => {
    for (const key of [`0x${"00".repeat(32)}`, CURVE_ORDER] as const) {
      for (const backend of ["wasm", "js"] as const) {
        if (backend === "js") _setPrivateKeyBackendLoaderForTests(() => Promise.resolve(undefined));
        try {
          const carrier = createPrivateKeyWallet(key);
          await expect(signL1Action({ wallet: carrier, action: { ...CANCEL }, nonce: NONCE }), backend).rejects.toThrow(
            "secp256k1 scalar range",
          );
          await expect(getWalletAddress(carrier), backend).rejects.toThrow("secp256k1 scalar range");
        } finally {
          _setPrivateKeyBackendLoaderForTests(undefined);
        }
      }
    }
  });

  test("the carrier exposes no enumerable key material", () => {
    const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY) as unknown as Record<string, unknown>;
    expect(Object.keys(carrier)).toEqual([]);
    expect(JSON.stringify(carrier)).not.toContain(WELL_KNOWN_KEY.slice(2));
    expect(Object.isFrozen(carrier)).toBe(true);
  });

  test("_privateKeyWalletBackend() throws for a non-carrier wallet", () => {
    expect(() => _privateKeyWalletBackend(privateKeyToAccount(WELL_KNOWN_KEY))).toThrow(AbstractWalletError);
  });
});

// --- ExchangeClient integration ------------------------------------------------

describe("ExchangeClient with a raw private key", () => {
  test("order() posts a signature identical to the viem account's for the same nonce", async () => {
    const { calls, transport } = recordingTransport();
    const config = { transport, wallet: WELL_KNOWN_KEY, nonceManager: () => FIXED_NONCE } as const;
    const client = new ExchangeClient(config);

    const params: CoinOrderParameters = { orders: [LIMIT_ORDER], grouping: "na" };
    await client.order(params);

    const oracle = recordingTransport();
    const oracleClient = new ExchangeClient({
      transport: oracle.transport,
      wallet: privateKeyToAccount(WELL_KNOWN_KEY),
      nonceManager: () => FIXED_NONCE,
    });
    await oracleClient.order(params);

    expect(calls.length).toBe(1);
    expect(calls[0].payload.signature).toEqual(oracle.calls[0].payload.signature);
    expect(calls[0].payload.action).toEqual(oracle.calls[0].payload.action);
    // The config object is never rewritten: `wallet` stays the original string.
    expect(config.wallet).toBe(WELL_KNOWN_KEY);
  });

  test("user-signed method (approveAgent) matches the viem account byte-for-byte", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient({
      transport,
      wallet: WELL_KNOWN_KEY,
      nonceManager: () => FIXED_NONCE,
      signatureChainId: "0x66eee",
    });
    await client.approveAgent({ agentAddress: "0x0000000000000000000000000000000000000001", agentName: "Agent" });

    const oracle = recordingTransport();
    const oracleClient = new ExchangeClient({
      transport: oracle.transport,
      wallet: privateKeyToAccount(WELL_KNOWN_KEY),
      nonceManager: () => FIXED_NONCE,
      signatureChainId: "0x66eee",
    });
    await oracleClient.approveAgent({ agentAddress: "0x0000000000000000000000000000000000000001", agentName: "Agent" });

    expect(calls[0].payload.signature).toEqual(oracle.calls[0].payload.signature);
  });

  test("a malformed key string throws synchronously from the constructor", () => {
    const { transport } = recordingTransport();
    expect(() => new ExchangeClient({ transport, wallet: "0x1234" })).toThrow(AbstractWalletError);
  });

  test("warmup() signs throwaway actions with the carrier (in-process key) and awaits init", async () => {
    const carrier = createPrivateKeyWallet(WELL_KNOWN_KEY);
    // Would throw if the carrier were not treated as in-process (it would skip signing and the
    // backend assertion below would race initialization) or if signing failed.
    await warmupSigning(carrier);
    expect(await _privateKeyWalletBackend(carrier)).toBe("wasm");
  });
});

// --- Public identity helpers and wallet objects --------------------------------

describe("public helpers accept the key string form of config.wallet", () => {
  test("getWalletAddress / getWalletChainId / warmupSigning take a raw key string", async () => {
    const { getWalletChainId } = await import("@bloxwap/hyperliquid/signing");
    const expected = privateKeyToAccount(WELL_KNOWN_KEY).address.toLowerCase();
    expect(await getWalletAddress(WELL_KNOWN_KEY)).toBe(expected as `0x${string}`);
    expect(await getWalletChainId(WELL_KNOWN_KEY)).toBe("0x1");
    await warmupSigning(WELL_KNOWN_KEY);
    await warmupSigning([WELL_KNOWN_KEY, privateKeyToAccount(WELL_KNOWN_KEY)]);
  });

  test("getWalletAddress(client.config.wallet) works for a key-string client (compat pattern)", async () => {
    const { transport } = recordingTransport();
    const client = new ExchangeClient({ transport, wallet: WELL_KNOWN_KEY });
    expect(await getWalletAddress(client.config.wallet)).toBe(
      privateKeyToAccount(WELL_KNOWN_KEY).address.toLowerCase() as `0x${string}`,
    );
  });

  test("a malformed key string rejects (not throws) from getWalletAddress", async () => {
    await expect(getWalletAddress("0x1234")).rejects.toThrow(AbstractWalletError);
  });

  test("wallet objects pass through configWallet untouched", async () => {
    const { configWallet } = await import("../../src/api/exchange/_methods/_base/_wallet.ts");
    const { transport } = recordingTransport();
    const viemAccount = privateKeyToAccount(WELL_KNOWN_KEY);
    expect(configWallet({ transport, wallet: viemAccount })).toBe(viemAccount);
    const keyConfig = { transport, wallet: WELL_KNOWN_KEY as `0x${string}` };
    // One carrier per config object, reused across calls.
    expect(configWallet(keyConfig)).toBe(configWallet(keyConfig));
  });
});
