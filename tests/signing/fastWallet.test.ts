/**
 * Differential conformance tests for the WASM fast local wallet.
 *
 * `src/signing/_fastWallet.ts` swaps noble's pure-JS secp256k1 for `tiny-secp256k1` (WASM
 * libsecp256k1) on the raw-digest `sign({ hash })` the L1 path uses. The signature authorizes
 * real orders, so viem is kept as the oracle here: for a matrix of private keys x
 * mainnet/testnet x actions, the WASM path's final signature (r, s, v) must be byte-identical
 * to the noble/viem path. The fallback (missing WASM module, `wasm: false`) and the typed-data
 * delegation are pinned against viem the same way.
 *
 * Fallback simulation goes through `_setEccLoaderForTests`, not module mocking: a mocked
 * specifier stays poisoned for the rest of the process and an already-cached real module
 * shadows the mock, so under `bun test` which path ran would depend on test-file order — the
 * worst outcome for a consensus-critical differential test.
 * @module
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  type AbstractViemLocalAccount,
  createFastLocalWallet,
  signL1Action,
  signMultiSigL1,
  signUserSignedAction,
} from "@bloxwap/hyperliquid/signing";
import { ApproveAgentTypes } from "@bloxwap/hyperliquid/api/exchange";
import { _setEccLoaderForTests, loadTinySecp256k1 } from "../../src/signing/_fastWallet.ts";

// --- Fixtures (same shapes as tests/signing/fastDigest.test.ts) --------------

const PRIVATE_KEYS = [
  // The well-known test key used across the suite
  "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  // Boundary-shaped keys: minimal, and top-bit set
  "0x0000000000000000000000000000000000000000000000000000000000000001",
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140",
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
const CANCEL_BY_CLOID = {
  type: "cancelByCloid",
  cancels: [{ asset: 0, cloid: "0x1234567890abcdef1234567890abcdef" }],
} as const;
const SCHEDULE_CANCEL = { type: "scheduleCancel", time: 1700000060000 } as const;

/** Representative L1 actions: a multi-field order, hash modifiers, and the small fixed shapes. */
const CASES: readonly { label: string; action: Record<string, unknown>; vault?: `0x${string}`; expires?: number }[] = [
  { label: "order with cloid", action: ORDER_WITH_CLOID },
  { label: "order with cloid + vault", action: ORDER_WITH_CLOID, vault: VAULT },
  { label: "order with cloid + expiry", action: ORDER_WITH_CLOID, expires: EXPIRES },
  { label: "order with cloid + vault + expiry", action: ORDER_WITH_CLOID, vault: VAULT, expires: EXPIRES },
  { label: "cancel", action: CANCEL },
  { label: "cancelByCloid", action: CANCEL_BY_CLOID },
  { label: "scheduleCancel", action: SCHEDULE_CANCEL },
];

const APPROVE_AGENT = {
  type: "approveAgent",
  signatureChainId: "0x66eee",
  hyperliquidChain: "Testnet",
  agentAddress: "0x0000000000000000000000000000000000000001",
  agentName: "Agent",
  nonce: NONCE,
} as const;

afterEach(() => {
  // Restore the real loader (and reset the warning latch) whatever a test did.
  _setEccLoaderForTests(undefined);
});

// --- WASM path: address and raw-digest signing --------------------------------

describe("createFastLocalWallet() WASM path", () => {
  test("derives the same address as viem", async () => {
    for (const privateKey of PRIVATE_KEYS) {
      const fast = await createFastLocalWallet(privateKey);
      const oracle = privateKeyToAccount(privateKey);
      // Exact equality, including EIP-55 checksum casing: the wallet is a drop-in viem replacement.
      expect(fast.address, privateKey.slice(0, 10)).toBe(oracle.address);
    }
  });

  test("sign({ hash }) is byte-identical to viem across keys x digests", async () => {
    const digests = [
      // The pinned mainnet/testnet Agent digests from fastDigest.test.ts
      "0xcf97446596762e207bece6115520a233d4cec3c8f22c5193a633baa610233d8e",
      "0x9e83d71366d4323b7c4830d17c68f71fb730ce3b2edf19e5110c0712140c9931",
      // Boundary-shaped digests: all-zero and all-ones
      `0x${"00".repeat(32)}`,
      `0x${"ff".repeat(32)}`,
    ] as const;
    for (const privateKey of PRIVATE_KEYS) {
      const fast = await createFastLocalWallet(privateKey);
      const oracle = privateKeyToAccount(privateKey);
      for (const hash of digests) {
        const context = `${privateKey.slice(0, 10)} / ${hash.slice(0, 10)}`;
        expect(await fast.sign!({ hash }), context).toBe(await oracle.sign({ hash }));
      }
    }
  });

  test("rejects an invalid private key instead of signing", async () => {
    // Zero scalar: valid hex, outside the secp256k1 range
    await expect(createFastLocalWallet(`0x${"00".repeat(32)}`)).rejects.toThrow("secp256k1 scalar range");
    // Malformed hex
    await expect(createFastLocalWallet("0x1234" as `0x${string}`)).rejects.toThrow("32-byte hex private key");
  });
});

// --- WASM path: end-to-end signature conformance ------------------------------

describe("createFastLocalWallet() through the signing functions", () => {
  test("signL1Action() is byte-identical to viem across keys x actions x networks", async () => {
    for (const privateKey of PRIVATE_KEYS) {
      const fast = await createFastLocalWallet(privateKey);
      const oracle = privateKeyToAccount(privateKey);
      for (const { label, action, vault, expires } of CASES) {
        for (const isTestnet of [false, true]) {
          const args = {
            action: { ...action },
            nonce: NONCE,
            isTestnet,
            vaultAddress: vault,
            expiresAfter: expires,
          };
          const context = `${privateKey.slice(0, 10)} / ${label} / ${isTestnet ? "testnet" : "mainnet"}`;
          expect(await signL1Action({ wallet: fast, ...args }), context).toEqual(
            await signL1Action({ wallet: oracle, ...args }),
          );
        }
      }
    }
  });

  test("signUserSignedAction() matches viem (typed data delegates to a viem account)", async () => {
    for (const privateKey of PRIVATE_KEYS) {
      const fast = await createFastLocalWallet(privateKey);
      const oracle = privateKeyToAccount(privateKey);
      const context = privateKey.slice(0, 10);
      expect(
        await signUserSignedAction({ wallet: fast, action: { ...APPROVE_AGENT }, types: ApproveAgentTypes }),
        context,
      ).toEqual(await signUserSignedAction({ wallet: oracle, action: { ...APPROVE_AGENT }, types: ApproveAgentTypes }));
    }
  });

  test("signMultiSigL1() matches viem (inner WASM digests + outer typed-data wrapper)", async () => {
    const fastSigners = await Promise.all(PRIVATE_KEYS.slice(0, 3).map((key) => createFastLocalWallet(key)));
    const oracleSigners = PRIVATE_KEYS.slice(0, 3).map((key) => privateKeyToAccount(key));
    const args = {
      multiSigUser: "0x1234567890123456789012345678901234567890",
      signatureChainId: "0x66eee",
      action: { ...ORDER_WITH_CLOID },
      nonce: NONCE,
      isTestnet: true,
    } as const;

    expect(await signMultiSigL1({ signers: fastSigners as never, ...args })).toEqual(
      await signMultiSigL1({ signers: oracleSigners as never, ...args }),
    );
  });

  test("engages the WASM raw-digest path (not signTypedData) for L1 actions", async () => {
    const fast = await createFastLocalWallet(PRIVATE_KEYS[0]);
    let signCalls = 0;
    let typedDataCalls = 0;
    const wallet: AbstractViemLocalAccount = {
      address: fast.address,
      sign: (args) => {
        signCalls++;
        return fast.sign!(args);
      },
      signTypedData: (params) => {
        typedDataCalls++;
        return fast.signTypedData(params);
      },
    };

    await signL1Action({ wallet, action: { ...CANCEL }, nonce: NONCE });

    expect(signCalls).toBe(1);
    expect(typedDataCalls).toBe(0);
  });
});

// --- Fallback path -------------------------------------------------------------

describe("createFastLocalWallet() fallback", () => {
  test("falls back to the viem/noble path with a one-time warning when the WASM module is missing", async () => {
    _setEccLoaderForTests(() => Promise.resolve(undefined));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fast = await createFastLocalWallet(PRIVATE_KEYS[0]);
      const second = await createFastLocalWallet(PRIVATE_KEYS[1]);
      expect(warn).toHaveBeenCalledTimes(1);

      const args = { action: { ...CANCEL }, nonce: NONCE, isTestnet: true } as const;
      expect(await signL1Action({ wallet: fast, ...args })).toEqual(
        await signL1Action({ wallet: privateKeyToAccount(PRIVATE_KEYS[0]), ...args }),
      );
      // The fallback account must still carry the raw-digest capability (via viem), like any local account.
      expect(typeof second.sign).toBe("function");
      expect(second.address).toBe(privateKeyToAccount(PRIVATE_KEYS[1]).address);
    } finally {
      warn.mockRestore();
    }
  });

  test("an injected `privateKeyToAccount` is used instead of the dynamic import", async () => {
    // Environments that cannot service `import()` (Jest without `--experimental-vm-modules`, some
    // React Native bundlers) pass viem's factory in. It must be used on both viem-dependent paths.
    _setEccLoaderForTests(() => Promise.resolve(undefined));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      let injectedCalls = 0;
      const injected = (key: `0x${string}`): ReturnType<typeof privateKeyToAccount> => {
        injectedCalls++;
        return privateKeyToAccount(key);
      };

      const fast = await createFastLocalWallet(PRIVATE_KEYS[0], { privateKeyToAccount: injected });
      expect(injectedCalls).toBeGreaterThan(0);
      expect(fast.address).toBe(privateKeyToAccount(PRIVATE_KEYS[0]).address);

      const args = { action: { ...CANCEL }, nonce: NONCE, isTestnet: true } as const;
      expect(await signL1Action({ wallet: fast, ...args })).toEqual(
        await signL1Action({ wallet: privateKeyToAccount(PRIVATE_KEYS[0]), ...args }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  test("the WASM path uses an injected `privateKeyToAccount` for signTypedData", async () => {
    // With WASM present the fallback never runs, but `signTypedData` still needs viem.
    let injectedCalls = 0;
    const injected = (key: `0x${string}`): ReturnType<typeof privateKeyToAccount> => {
      injectedCalls++;
      return privateKeyToAccount(key);
    };

    const fast = await createFastLocalWallet(PRIVATE_KEYS[0], { privateKeyToAccount: injected });
    expect(injectedCalls).toBe(0); // not needed until typed data is signed

    const signed = await fast.signTypedData({
      domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: `0x${"00".repeat(20)}` },
      types: {
        Agent: [
          { name: "source", type: "string" },
          { name: "connectionId", type: "bytes32" },
        ],
      },
      primaryType: "Agent",
      message: { source: "a", connectionId: `0x${"11".repeat(32)}` },
    });

    expect(injectedCalls).toBe(1);
    expect(signed).toBe(
      await privateKeyToAccount(PRIVATE_KEYS[0]).signTypedData({
        domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: `0x${"00".repeat(20)}` },
        types: {
          Agent: [
            { name: "source", type: "string" },
            { name: "connectionId", type: "bytes32" },
          ],
        },
        primaryType: "Agent",
        message: { source: "a", connectionId: `0x${"11".repeat(32)}` },
      }),
    );
  });

  test("rejects an injected factory that ignores the private key it is given", async () => {
    // `() => someOtherAccount` type-checks, and on the WASM path it would split the wallet:
    // L1 digests signed by the WASM key, typed data by the injected account's key.
    const wrongKeyFactory = (): ReturnType<typeof privateKeyToAccount> => privateKeyToAccount(PRIVATE_KEYS[1]);
    const fast = await createFastLocalWallet(PRIVATE_KEYS[0], { privateKeyToAccount: wrongKeyFactory });

    // The wallet itself is fine; only the typed-data delegate is wrong, so it fails there.
    expect(fast.address).toBe(privateKeyToAccount(PRIVATE_KEYS[0]).address);
    await expect(
      signUserSignedAction({ wallet: fast, action: { ...APPROVE_AGENT }, types: ApproveAgentTypes }),
    ).rejects.toThrow("must derive the account from the private key it is given");
  });

  test("`wasm: false` takes the viem/noble path without loading or warning", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fast = await createFastLocalWallet(PRIVATE_KEYS[0], { wasm: false });
      expect(warn).not.toHaveBeenCalled();

      const args = { action: { ...ORDER_WITH_CLOID }, nonce: NONCE, isTestnet: false } as const;
      expect(await signL1Action({ wallet: fast, ...args })).toEqual(
        await signL1Action({ wallet: privateKeyToAccount(PRIVATE_KEYS[0]), ...args }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

// --- WASM module validation -----------------------------------------------------

describe("createFastLocalWallet() WASM module validation", () => {
  test("throws when the module cannot derive a public key from the private key", async () => {
    // `pointFromScalar` returning null: the guard rejects instead of building a broken address.
    _setEccLoaderForTests(() =>
      Promise.resolve({
        isPrivate: () => true,
        pointFromScalar: () => null,
        signRecoverable: () => {
          throw new Error("unreachable");
        },
      }),
    );
    await expect(createFastLocalWallet(PRIVATE_KEYS[0])).rejects.toThrow("Failed to derive the public key");

    // A malformed (wrong-length) point hits the same guard.
    _setEccLoaderForTests(() =>
      Promise.resolve({
        isPrivate: () => true,
        pointFromScalar: () => new Uint8Array(33),
        signRecoverable: () => {
          throw new Error("unreachable");
        },
      }),
    );
    await expect(createFastLocalWallet(PRIVATE_KEYS[0])).rejects.toThrow("Failed to derive the public key");
  });
});

// --- Real loader failure arms ---------------------------------------------------

describe("loadTinySecp256k1() failure arms", () => {
  test("returns undefined when the real import rejects (dependency absent)", async () => {
    // The same code path the default call takes: a rejecting import lands in the catch arm.
    await expect(loadTinySecp256k1(() => Promise.reject(new Error("Cannot find module")))).resolves.toBeUndefined();
  });

  test("returns undefined when the module is partially linked (shape check)", async () => {
    // Missing one of the three required functions — the shape guard routes to the fallback.
    await expect(
      loadTinySecp256k1(() =>
        Promise.resolve({ signRecoverable: () => new Uint8Array(65), pointFromScalar: () => new Uint8Array(33) }),
      ),
    ).resolves.toBeUndefined();
  });

  test("returns the module when the shape check passes", async () => {
    const ecc = {
      isPrivate: () => true,
      pointFromScalar: () => new Uint8Array(33),
      signRecoverable: () => ({ signature: new Uint8Array(64), recoveryId: 0 }),
    };
    await expect(loadTinySecp256k1(() => Promise.resolve(ecc))).resolves.toBe(ecc);
  });

  test("the default import resolves to the real tiny-secp256k1", async () => {
    const ecc = await loadTinySecp256k1();
    expect(typeof ecc?.signRecoverable).toBe("function");
  });
});

// --- JSON-RPC wallets stay untouched --------------------------------------------

describe("createFastLocalWallet() alongside JSON-RPC wallets", () => {
  test("a JSON-RPC wallet never takes the raw-digest path, even backed by a WASM-capable signer", async () => {
    const fast = await createFastLocalWallet(PRIVATE_KEYS[0]);
    let typedDataCalls = 0;
    // JSON-RPC shape: signTypedData + getAddresses + getChainId, and NO address field. The typed-data
    // endpoint is the fast wallet's own, so any misrouting to a digest capability would show up here.
    const wallet = {
      signTypedData: (params: never) => {
        typedDataCalls++;
        return fast.signTypedData(params);
      },
      getAddresses: () => Promise.resolve([fast.address]),
      getChainId: () => Promise.resolve(1337),
    };

    const jsonRpc = await signL1Action({ wallet, action: { ...CANCEL }, nonce: NONCE });
    const oracle = await signL1Action({
      wallet: privateKeyToAccount(PRIVATE_KEYS[0]),
      action: { ...CANCEL },
      nonce: NONCE,
    });

    expect(typedDataCalls).toBe(1);
    expect(jsonRpc).toEqual(oracle);
  });
});
