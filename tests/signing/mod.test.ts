/**
 * Signature fixtures for the signing module: L1 action hashing, EIP-712 user
 * signing, and multi-sig envelope construction.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import { createWalletClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

import {
  AbstractWalletError,
  createL1ActionHash,
  getWalletAddress,
  getWalletChainId,
  signL1Action,
  signMultiSigL1,
  signMultiSigUserSigned,
  signUserSignedAction,
} from "@bloxwap/hyperliquid/signing";
import { signRawDigest, signTypedData } from "../../src/signing/_abstractWallet.ts";

// ============================================================
// Test Data
// ============================================================

const PRIVATE_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";

// createL1ActionHash() and signL1Action()
const L1_ACTION = {
  action: {
    type: "order",
    orders: [
      {
        a: 0,
        b: true,
        p: "30000",
        s: "0.1",
        r: false,
        t: { limit: { tif: "Gtc" } },
      },
    ],
    grouping: "na",
  },
  nonce: 1234567890,
  vaultAddress: "0x1234567890123456789012345678901234567890",
  expiresAfter: 1234567890,
  hash: {
    base: "0x25367e0dba84351148288c2233cd6130ed6cec5967ded0c0b7334f36f957cc90",
    withVault: "0x214e2ea3270981b6fd18174216691e69f56872663139d396b10ded319cb4bb1e",
    withExpires: "0xc30b002ba3775e4c31c43c1dfd3291dfc85c6ae06c6b9f393991de86cad5fac7",
    withBoth: "0x2d62412aa0fc57441b5189841d81554a6a9680bf07204e1454983a9ca44f0744",
  },
  signature: {
    mainnet: {
      r: "0x61078d8ffa3cb591de045438a1ae2ed299b271891d1943a33901e7cfb3a31ed8",
      s: "0x0e91df4f9841641d3322dad8d932874b74d7e082cdb5b533f804964a6963aef9",
      v: 28,
    },
    testnet: {
      r: "0x6b0283a894d87b996ad0182b86251cc80d27d61ef307449a2ed249a508ded1f7",
      s: "0x6f884e79f4a0a10af62db831af6f8e03b3f11d899eb49b352f836746ee9226da",
      v: 27,
    },
  },
} as const;

// signUserSignedAction()
const USER_SIGNED_ACTION = {
  action: {
    hyperliquidChain: "Mainnet",
    signatureChainId: "0x66eee",
    destination: "0x1234567890123456789012345678901234567890",
    amount: "1000",
    time: 1234567890,
  },
  types: {
    "HyperliquidTransaction:UsdSend": [
      { name: "hyperliquidChain", type: "string" },
      { name: "destination", type: "string" },
      { name: "amount", type: "string" },
      { name: "time", type: "uint64" },
    ],
  },
  signature: {
    r: "0xf777c38efe7c24cc71209526ae608f4e384d0586edf578f0e97b4b9f7c7adcc6",
    s: "0x104a4a97c48ae77bf5bd777bdd45fe72d8f5ff29116b5ff64fd8cfe4ea610786",
    v: 28,
  },
} as const;

// signMultiSigL1()
const MULTI_SIG_L1 = {
  multiSigUser: "0x1234567890123456789012345678901234567890",
  signatureChainId: "0x66eee",
  nonce: 1234567890,
  result: {
    action: {
      type: "multiSig",
      signatureChainId: "0x66eee",
      signatures: [
        {
          r: "0x12a4e2b7cfc2b5fc3d1e7847573de88bf1172731392be62fa6a9f2de3772b5ba",
          s: "0x565f4ad818ae04b26624e548ed3d2a9d5a41a8b6460cfc1555a0fe07d6a56121",
          v: 27,
        },
      ],
      payload: {
        multiSigUser: "0x1234567890123456789012345678901234567890",
        outerSigner: "0xe5ca49fb3bd9a581f0d1ef9cb5d7177da08bf901",
        action: L1_ACTION.action,
      },
    },
    signature: {
      r: "0x6ce5dcb0b71db89f2b94f1427533013457e93d9b3f2b3d2b84bf8a0cb0ec008f",
      s: "0x04e8981a177b328bebaae28598827f0aeee8be5b6f62756d81f6e71830c2103d",
      v: 28,
    },
  },
} as const;

// signMultiSigUserSigned()
const MULTI_SIG_USER_SIGNED = {
  multiSigUser: "0x1234567890123456789012345678901234567890",
  result: {
    action: {
      type: "multiSig",
      signatureChainId: "0x66eee",
      signatures: [
        {
          r: "0xccc3921f376f76abb13fbc2892808acea98fa7471633c103430f407f75b64375",
          s: "0x5b8f3608927dddafdc6b8a9a7ee95177caa9eb3e00c81af21892cb80b2bcfb15",
          v: 28,
        },
      ],
      payload: {
        multiSigUser: "0x1234567890123456789012345678901234567890",
        outerSigner: "0xe5ca49fb3bd9a581f0d1ef9cb5d7177da08bf901",
        action: USER_SIGNED_ACTION.action,
      },
    },
    signature: {
      r: "0x8927ad27b2ee54f6c4d6fb2ae4841835dd3c82c705a0afd055c8ce75ae3f4130",
      s: "0x7b555ee328026846560fed75501b1af2c4774636d5e06f09fe8c9faee9ee4075",
      v: 27,
    },
  },
} as const;

const MULTI_SIG_USER_SET_ABSTRACTION = {
  multiSigUser: "0x1234567890123456789012345678901234567890",
  action: {
    type: "userSetAbstraction",
    signatureChainId: "0x66eee",
    hyperliquidChain: "Testnet",
    user: "0x3b4d2cc2e144a0044002506c8b44508e9ace82e9",
    abstraction: "disabled",
    nonce: 1780130409592,
  },
  payloadAction: {
    type: "userSetAbstraction",
    signatureChainId: "0x66eee",
    hyperliquidChain: "Testnet",
    user: "0x3b4d2cc2e144a0044002506c8b44508e9ace82e9",
    abstraction: "i",
    nonce: 1780130409592,
  },
  types: {
    "HyperliquidTransaction:UserSetAbstraction": [
      { name: "hyperliquidChain", type: "string" },
      { name: "user", type: "address" },
      { name: "abstraction", type: "string" },
      { name: "nonce", type: "uint64" },
    ],
  },
  result: {
    action: {
      type: "multiSig",
      signatureChainId: "0x66eee",
      signatures: [
        {
          r: "0xbeaaefe1f198650d10751bde2d398f2c27b00ce27df76b02a49e01b6cf674a0c",
          s: "0x918a44e4ec29e6cba349ee48a177490d04e7b01ea23fd6845c274dc7150e91c",
          v: 27,
        },
      ],
      payload: {
        multiSigUser: "0x1234567890123456789012345678901234567890",
        outerSigner: "0xe5ca49fb3bd9a581f0d1ef9cb5d7177da08bf901",
        action: {
          type: "userSetAbstraction",
          signatureChainId: "0x66eee",
          hyperliquidChain: "Testnet",
          user: "0x3b4d2cc2e144a0044002506c8b44508e9ace82e9",
          abstraction: "i",
          nonce: 1780130409592,
        },
      },
    },
    signature: {
      r: "0x28159b1dc1496ca8d81c2aee9f2f73882b6f6f7f6a54509010cbdb08c5302699",
      s: "0x0d6832d115cd3149302afcbe1189875bc46e12f025d59aa618676f29cdc4ce6f",
      v: 28,
    },
  },
} as const;

// ============================================================
// Tests
// ============================================================

describe("signing", () => {
  // Viem is the only wallet flavour the library ships support for; the ethers cases were
  // dropped together with the ethers dependency.
  const wallets = [["Viem", privateKeyToAccount(PRIVATE_KEY)]] as const;

  describe("createL1ActionHash()", () => {
    test("base", () => {
      const actual = createL1ActionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
      });
      const expected = L1_ACTION.hash.base;

      assertEquals(actual, expected);
    });

    test("with vaultAddress", () => {
      const actual = createL1ActionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        vaultAddress: L1_ACTION.vaultAddress,
      });
      const expected = L1_ACTION.hash.withVault;

      assertEquals(actual, expected);
    });

    test("with expiresAfter", () => {
      const actual = createL1ActionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        expiresAfter: L1_ACTION.expiresAfter,
      });
      const expected = L1_ACTION.hash.withExpires;

      assertEquals(actual, expected);
    });

    test("with vaultAddress + expiresAfter", () => {
      const actual = createL1ActionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        vaultAddress: L1_ACTION.vaultAddress,
        expiresAfter: L1_ACTION.expiresAfter,
      });
      const expected = L1_ACTION.hash.withBoth;

      assertEquals(actual, expected);
    });
  });

  describe("signL1Action()", () => {
    for (const network of ["mainnet", "testnet"] as const) {
      describe(network, () => {
        for (const [name, wallet] of wallets) {
          test(name, async () => {
            const actual = await signL1Action({
              wallet,
              isTestnet: network === "testnet",
              action: L1_ACTION.action,
              nonce: L1_ACTION.nonce,
            });
            const expected = L1_ACTION.signature[network];

            assertEquals(actual, expected);
          });
        }
      });
    }
  });

  describe("signUserSignedAction()", () => {
    for (const [name, wallet] of wallets) {
      test(name, async () => {
        const actual = await signUserSignedAction({
          wallet,
          action: USER_SIGNED_ACTION.action,
          types: USER_SIGNED_ACTION.types,
        });
        const expected = USER_SIGNED_ACTION.signature;

        assertEquals(actual, expected);
      });
    }
  });

  describe("signMultiSigL1()", () => {
    for (const [name, wallet] of wallets) {
      test(name, async () => {
        const result = await signMultiSigL1({
          signers: [wallet],
          multiSigUser: MULTI_SIG_L1.multiSigUser,
          signatureChainId: MULTI_SIG_L1.signatureChainId,
          action: L1_ACTION.action,
          nonce: MULTI_SIG_L1.nonce,
        });
        const expected = MULTI_SIG_L1.result;

        assertEquals(result, expected);
      });
    }
  });

  describe("signMultiSigUserSigned()", () => {
    for (const [name, wallet] of wallets) {
      test(name, async () => {
        const result = await signMultiSigUserSigned({
          signers: [wallet],
          multiSigUser: MULTI_SIG_USER_SIGNED.multiSigUser,
          action: USER_SIGNED_ACTION.action,
          types: USER_SIGNED_ACTION.types,
        });
        const expected = MULTI_SIG_USER_SIGNED.result;

        assertEquals(result, expected);
      });
    }
  });

  describe("signMultiSigUserSigned() with distinct payload action", () => {
    for (const [name, wallet] of wallets) {
      test(name, async () => {
        const result = await signMultiSigUserSigned({
          signers: [wallet],
          multiSigUser: MULTI_SIG_USER_SET_ABSTRACTION.multiSigUser,
          action: MULTI_SIG_USER_SET_ABSTRACTION.action,
          payloadAction: MULTI_SIG_USER_SET_ABSTRACTION.payloadAction,
          types: MULTI_SIG_USER_SET_ABSTRACTION.types,
        });
        const expected = MULTI_SIG_USER_SET_ABSTRACTION.result;

        assertEquals(result, expected);
        assertEquals(MULTI_SIG_USER_SET_ABSTRACTION.action.abstraction, "disabled");
      });
    }
  });

  describe("getWalletChainId()", () => {
    describe("viem local account", () => {
      test("default 0x1", async () => {
        const wallet = privateKeyToAccount(PRIVATE_KEY);

        const chainId = await getWalletChainId(wallet);
        assertEquals(chainId, "0x1");
      });

      test("hex chain ID", async () => {
        const wallet = createWalletClient({
          account: privateKeyToAccount(PRIVATE_KEY),
          chain: arbitrum,
          transport: custom({
            request: async ({ method }) => {
              if (method === "eth_chainId") return await Promise.resolve("0xa4b1");
              throw new Error(`Unexpected RPC method: ${method}`);
            },
          }),
        });

        const chainId = await getWalletChainId(wallet);
        assertEquals(chainId, "0xa4b1");
      });
    });
  });
});

// ============================================================
// Wallet error wrapping
// ============================================================

describe("wallet error wrapping (AbstractWalletError)", () => {
  const TYPED_DATA_ARGS = {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: 421614,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: { Agent: [{ name: "source", type: "string" }] },
    primaryType: "Agent",
    message: { source: "a" },
  } as const;
  const DIGEST = `0x${"11".repeat(32)}` as const;
  const VALID_HEX_SIGNATURE = `0x${"1".repeat(64)}${"2".repeat(64)}1b` as const;

  /** Minimal JSON-RPC wallet stub; individual methods are overridden per test. */
  function jsonRpcWallet(overrides: {
    signTypedData?: (_params: never) => Promise<`0x${string}`>;
    getAddresses?: () => Promise<`0x${string}`[]>;
    getChainId?: () => Promise<number>;
  }) {
    return {
      signTypedData: overrides.signTypedData ?? ((_params: never) => Promise.resolve(VALID_HEX_SIGNATURE)),
      getAddresses:
        overrides.getAddresses ?? (() => Promise.resolve(["0x1111111111111111111111111111111111111111" as const])),
      getChainId: overrides.getChainId ?? (() => Promise.resolve(1337)),
    };
  }

  /** Awaits a rejection and returns the caught error (fails if the call resolves). */
  async function caught(promise: Promise<unknown>): Promise<Error> {
    return promise.then(
      () => {
        throw new Error("expected the call to reject");
      },
      (error: unknown) => error as Error,
    );
  }

  describe("signTypedData()", () => {
    test("rejects a wallet signature that is not 65 bytes", async () => {
      const wallet = jsonRpcWallet({ signTypedData: (_params: never) => Promise.resolve("0x1234" as const) });

      const error = await caught(signTypedData({ wallet, ...TYPED_DATA_ARGS }));
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toBe("Expected 65-byte signature (132 hex chars), got 6");
    });

    test("rejects a wallet signature with an invalid recovery value", async () => {
      const wallet = jsonRpcWallet({
        signTypedData: (_params: never) => Promise.resolve(`0x${"1".repeat(64)}${"2".repeat(64)}1d` as const),
      });

      const error = await caught(signTypedData({ wallet, ...TYPED_DATA_ARGS }));
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toBe("Invalid signature recovery value: 29, expected 0/1 or 27/28");
    });

    test("wraps a non-SDK wallet failure, keeping the cause", async () => {
      const wallet = jsonRpcWallet({
        signTypedData: (_params: never) => Promise.reject(new Error("user rejected the request")),
      });

      const error = await caught(signTypedData({ wallet, ...TYPED_DATA_ARGS }));
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toBe("Failed to sign the typed data using the wallet");
      expect(error.cause).toBeInstanceOf(Error);
    });

    test("rethrows an AbstractWalletError unchanged", async () => {
      const failure = new AbstractWalletError("already an SDK error");
      const wallet = jsonRpcWallet({ signTypedData: (_params: never) => Promise.reject(failure) });

      const error = await caught(signTypedData({ wallet, ...TYPED_DATA_ARGS }));
      expect(error).toBe(failure);
    });
  });

  describe("signRawDigest()", () => {
    /** Minimal viem-local wallet stub whose raw-digest `sign` fails as instructed. */
    function localWallet(failure: Error) {
      return {
        address: "0x1111111111111111111111111111111111111111" as const,
        sign: (_args: { hash: `0x${string}` }) => Promise.reject(failure),
        signTypedData: (_params: never) => Promise.resolve(VALID_HEX_SIGNATURE),
      };
    }

    test("wraps a non-SDK wallet failure, keeping the cause", async () => {
      const error = await caught(
        signRawDigest({ wallet: localWallet(new Error("device disconnected")), digest: DIGEST }),
      );
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toBe("Failed to sign the digest using the wallet");
      expect(error.cause).toBeInstanceOf(Error);
    });

    test("rethrows an AbstractWalletError unchanged", async () => {
      const failure = new AbstractWalletError("already an SDK error");
      const error = await caught(signRawDigest({ wallet: localWallet(failure), digest: DIGEST }));
      expect(error).toBe(failure);
    });
  });

  describe("getWalletAddress()", () => {
    test("wraps a non-SDK lookup failure, keeping the cause", async () => {
      const wallet = jsonRpcWallet({ getAddresses: () => Promise.reject(new Error("rpc down")) });

      const error = await caught(getWalletAddress(wallet));
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toBe("Failed to get an address from the wallet");
      expect(error.cause).toBeInstanceOf(Error);
    });

    test("rethrows an AbstractWalletError unchanged", async () => {
      const failure = new AbstractWalletError("already an SDK error");
      const wallet = jsonRpcWallet({ getAddresses: () => Promise.reject(failure) });

      const error = await caught(getWalletAddress(wallet));
      expect(error).toBe(failure);
    });
  });

  describe("getWalletChainId()", () => {
    test("wraps a non-SDK lookup failure, keeping the cause", async () => {
      const wallet = jsonRpcWallet({ getChainId: () => Promise.reject(new Error("rpc down")) });

      const error = await caught(getWalletChainId(wallet));
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toBe("Failed to get the chain ID from the wallet");
      expect(error.cause).toBeInstanceOf(Error);
    });

    test("rethrows an AbstractWalletError unchanged", async () => {
      const failure = new AbstractWalletError("already an SDK error");
      const wallet = jsonRpcWallet({ getChainId: () => Promise.reject(failure) });

      const error = await caught(getWalletChainId(wallet));
      expect(error).toBe(failure);
    });
  });
});
