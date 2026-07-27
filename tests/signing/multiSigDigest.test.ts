/**
 * Differential conformance tests for the hand-rolled multi-sig outer digest fast path.
 *
 * `src/signing/_multiSig.ts` signs the fixed `HyperliquidTransaction:SendMultiSig` EIP-712 shape
 * through the hand-rolled digest in `src/signing/_fastDigest.ts` whenever the leader wallet can
 * sign a raw digest, and the digest it produces is signed — a single differing byte would
 * authorize a payload the user never approved. So viem is kept as the oracle here, in the style
 * of `fastDigest.test.ts`: the digest must be byte-identical to viem's `hashTypedData` across
 * chain IDs x wrapper hashes x nonces x networks, and the full `signMultiSigL1` /
 * `signMultiSigUserSigned` outputs must equal the same flows run with the raw-digest capability
 * stripped (forcing every signature through viem's `signTypedData`) across signer-set sizes,
 * multi-sig users, and inner action shapes. The precomputed constants are additionally pinned
 * to literals captured from viem's `hashTypedData`.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createL1ActionHash, signMultiSigL1, signMultiSigUserSigned } from "@bloxwap/hyperliquid/signing";
import { SIGN_DIGEST_BYTES } from "../../src/signing/_abstractWallet.ts";
import { createMultiSigDigest } from "../../src/signing/_fastDigest.ts";

// --- Oracle typed data -----------------------------------------

/** Mirrors the domain / `MULTI_SIG_TYPES` in `src/signing/_multiSig.ts`, with `EIP712Domain` as viem expects it. */
function oracleTypedData(args: {
  multiSigActionHash: `0x${string}`;
  nonce: number;
  signatureChainId: `0x${string}`;
  isTestnet: boolean;
}) {
  return {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: parseInt(args.signatureChainId, 16),
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      "HyperliquidTransaction:SendMultiSig": [
        { name: "hyperliquidChain", type: "string" },
        { name: "multiSigActionHash", type: "bytes32" },
        { name: "nonce", type: "uint64" },
      ],
    },
    primaryType: "HyperliquidTransaction:SendMultiSig",
    message: {
      hyperliquidChain: args.isTestnet ? "Testnet" : "Mainnet",
      multiSigActionHash: args.multiSigActionHash,
      nonce: args.nonce,
    },
  } as const;
}

// --- Fixtures --------------------------------------------------

const PRIVATE_KEYS = [
  // The well-known test key used across the suite
  "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

/** Eleven distinct keys (1..11 as 32-byte big-endian) for the maximum realistic signer set. */
const ELEVEN_KEYS = Array.from(
  { length: 11 },
  (_, i) => `0x${(i + 1).toString(16).padStart(64, "0")}` as `0x${string}`,
);

const NONCE = 1700000000000;

/** `0x66eee` is the Hyperliquid mainnet default; the rest exercise the per-chain domain separator cache. */
const SIGNATURE_CHAIN_IDS = ["0x66eee", "0x1", "0xa4b1", "0x539", "0xaa36a7"] as const;

const NONCES = [0, 1, 1234567890, 1700000000000, 9007199254740991] as const;

const MULTI_SIG_ACTION_HASHES = [
  "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d",
  "0x124a730fa73e0369fa3cb2183bc6cce521491bee320b80d4b7a2062dd0f11578",
  "0x0000000000000000000000000000000000000000000000000000000000000000",
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
] as const;

const MULTI_SIG_USERS = [
  "0x1234567890123456789012345678901234567890",
  // Mixed-case input: both flows lowercase it before hashing, so the comparison stays honest.
  "0xaBcdEf1234567890aBcDeF1234567890aBcDeF12",
] as const;

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

const L1_ACTIONS: readonly [label: string, action: Record<string, unknown>][] = [
  ["order with cloid", ORDER_WITH_CLOID],
  ["cancel", CANCEL],
];

/** Mirrors `ApproveAgentTypes` from `@bloxwap/hyperliquid/api/exchange`. */
const APPROVE_AGENT_TYPES = {
  "HyperliquidTransaction:ApproveAgent": [
    { name: "hyperliquidChain", type: "string" },
    { name: "agentAddress", type: "address" },
    { name: "agentName", type: "string" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

function approveAgentAction(signatureChainId: `0x${string}`, hyperliquidChain: "Mainnet" | "Testnet") {
  return {
    type: "approveAgent",
    signatureChainId,
    hyperliquidChain,
    agentAddress: "0x0000000000000000000000000000000000000001",
    agentName: "Agent",
    nonce: NONCE,
  } as const;
}

type ViemAccount = ReturnType<typeof privateKeyToAccount>;

/** The same account with the raw-digest capability removed: every signature goes through viem's `signTypedData`. */
function stripped(account: ViemAccount) {
  return {
    address: account.address,
    signTypedData: (params: never) => account.signTypedData(params),
  };
}

function toSigners(keys: readonly `0x${string}`[]): [ViemAccount, ...ViemAccount[]] {
  return keys.map((key) => privateKeyToAccount(key)) as [ViemAccount, ...ViemAccount[]];
}

// --- Digest conformance ----------------------------------------

describe("createMultiSigDigest()", () => {
  test("matches viem hashTypedData across chain IDs x hashes x nonces x networks", () => {
    for (const signatureChainId of SIGNATURE_CHAIN_IDS) {
      for (const multiSigActionHash of MULTI_SIG_ACTION_HASHES) {
        for (const nonce of NONCES) {
          for (const isTestnet of [false, true]) {
            const oracle = hashTypedData(
              oracleTypedData({ multiSigActionHash, nonce, signatureChainId, isTestnet }) as never,
            );
            const context = `${signatureChainId} / ${multiSigActionHash.slice(0, 10)} / ${nonce} / ${isTestnet ? "testnet" : "mainnet"}`;
            expect(createMultiSigDigest(multiSigActionHash, nonce, signatureChainId, isTestnet), context).toBe(oracle);
          }
        }
      }
    }
  });

  test("keeps the known-good digests (pins the precomputed constants)", () => {
    // Captured from viem `hashTypedData`; a wrong typehash, domain separator, or chain-name hash breaks these.
    const multiSigActionHash = "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d";
    expect(createMultiSigDigest(multiSigActionHash, NONCE, "0x66eee", false)).toBe(
      "0x8787c4dec7b0239c00061e871f021ea12acf7cbc3d48cc68f9878bbd52bb4083",
    );
    expect(createMultiSigDigest(multiSigActionHash, NONCE, "0x66eee", true)).toBe(
      "0x9b0b43aec4718137453fba362dcb1934b80de0c80744e8f616b71103736d72f3",
    );
    expect(createMultiSigDigest(multiSigActionHash, NONCE, "0x1", false)).toBe(
      "0xe5df1546b9bc112c730d60f1f6e7c8574abd72a32ccf4bf25dd9fbe43fcb9aa5",
    );
  });
});

// --- L1 flow: signature conformance ----------------------------

describe("signMultiSigL1() fast path", () => {
  test("is byte-identical to the typed-data path across signer sets x chain IDs x users x actions x networks", async () => {
    for (const signerCount of [1, 2, 3, 11] as const) {
      const signers = toSigners(ELEVEN_KEYS.slice(0, signerCount));
      const oracleSigners = signers.map(stripped) as [ReturnType<typeof stripped>, ...ReturnType<typeof stripped>[]];
      for (const signatureChainId of ["0x66eee", "0x1"] as const) {
        for (const multiSigUser of MULTI_SIG_USERS) {
          for (const [label, action] of L1_ACTIONS) {
            for (const isTestnet of [false, true]) {
              const args = { multiSigUser, signatureChainId, action: { ...action }, nonce: NONCE, isTestnet } as const;
              const fast = await signMultiSigL1({ signers, ...args });
              const oracle = await signMultiSigL1({ signers: oracleSigners, ...args });
              const context = `${signerCount} signers / ${signatureChainId} / ${multiSigUser.slice(0, 10)} / ${label} / ${
                isTestnet ? "testnet" : "mainnet"
              }`;
              expect(fast, context).toEqual(oracle);
            }
          }
        }
      }
    }
  });

  test("signs the outer wrapper through the raw-digest path, never signTypedData", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    let signCalls = 0;
    let typedDataCalls = 0;
    const wallet = {
      address: account.address,
      sign: (args: { hash: `0x${string}` }) => {
        signCalls++;
        return account.sign(args);
      },
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
    };

    await signMultiSigL1({
      signers: [wallet],
      multiSigUser: MULTI_SIG_USERS[0],
      signatureChainId: "0x66eee",
      action: { ...CANCEL },
      nonce: NONCE,
    });

    // One signer: one inner Agent signature + one outer SendMultiSig signature, both raw-digest.
    expect(signCalls).toBe(2);
    expect(typedDataCalls).toBe(0);
  });

  test("signs exactly viem's SendMultiSig digest as the outer signature", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    const signedDigests: `0x${string}`[] = [];
    const wallet = {
      address: account.address,
      sign: (args: { hash: `0x${string}` }) => {
        signedDigests.push(args.hash);
        return account.sign(args);
      },
      signTypedData: (params: never) => account.signTypedData(params),
    };
    const signatureChainId = "0x66eee";

    const { action: wrapper } = await signMultiSigL1({
      signers: [wallet],
      multiSigUser: MULTI_SIG_USERS[0],
      signatureChainId,
      action: { ...ORDER_WITH_CLOID },
      nonce: NONCE,
      isTestnet: true,
    });

    // Reconstruct the outer message independently: wrapper hash from the wire form, digest from viem.
    const { type: _, ...wrapperWithoutType } = wrapper;
    const multiSigActionHash = createL1ActionHash({ action: wrapperWithoutType, nonce: NONCE });
    const oracle = hashTypedData(
      oracleTypedData({ multiSigActionHash, nonce: NONCE, signatureChainId, isTestnet: true }) as never,
    );

    // Two digests were signed: the inner Agent digest first, the outer SendMultiSig digest last.
    expect(signedDigests.length).toBe(2);
    expect(signedDigests[1], "outer digest").toBe(oracle);
  });

  test("falls back to signTypedData for a leader without raw-digest signing", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    let typedDataCalls = 0;
    // Same local account, but with `sign` stripped: only `address` + `signTypedData` remain.
    const leader = {
      address: account.address,
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
    };
    const args = {
      multiSigUser: MULTI_SIG_USERS[0],
      signatureChainId: "0x66eee",
      action: { ...CANCEL },
      nonce: NONCE,
      isTestnet: true,
    } as const;

    const fallback = await signMultiSigL1({ signers: [leader], ...args });
    const fast = await signMultiSigL1({ signers: [account], ...args });

    // Stripped leader: the inner Agent signature and the outer SendMultiSig one both use signTypedData.
    expect(typedDataCalls).toBe(2);
    expect(fallback).toEqual(fast);
  });

  test("never uses the fast path for a JSON-RPC wallet", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    let typedDataCalls = 0;
    // JSON-RPC shape: signTypedData + getAddresses + getChainId, and NO address field. Even though the
    // underlying signer could sign a digest locally, the adapter must route through real signTypedData.
    const wallet = {
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
      getAddresses: () => Promise.resolve([account.address]),
      getChainId: () => Promise.resolve(1337),
    };
    const args = {
      multiSigUser: MULTI_SIG_USERS[0],
      signatureChainId: "0x66eee",
      action: { ...CANCEL },
      nonce: NONCE,
    } as const;

    const jsonRpc = await signMultiSigL1({ signers: [wallet], ...args });
    const fast = await signMultiSigL1({ signers: [account], ...args });

    expect(typedDataCalls).toBe(2);
    expect(jsonRpc).toEqual(fast);
  });

  test("prefers the SIGN_DIGEST_BYTES capability and hands it the exact digest bytes", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    const digests: Uint8Array[] = [];
    let hexSignCalls = 0;
    const wallet = {
      address: account.address,
      sign: (args: { hash: `0x${string}` }) => {
        hexSignCalls++;
        return account.sign(args);
      },
      [SIGN_DIGEST_BYTES]: (digest: Uint8Array) => {
        digests.push(digest);
        return account.sign({ hash: `0x${bytesToHex(digest)}` });
      },
      signTypedData: (params: never) => account.signTypedData(params),
    };
    const signatureChainId = "0x66eee";

    const { action: wrapper, signature } = await signMultiSigL1({
      signers: [wallet],
      multiSigUser: MULTI_SIG_USERS[0],
      signatureChainId,
      action: { ...CANCEL },
      nonce: NONCE,
    });

    const { type: _, ...wrapperWithoutType } = wrapper;
    const multiSigActionHash = createL1ActionHash({ action: wrapperWithoutType, nonce: NONCE });
    const oracle = hashTypedData(
      oracleTypedData({ multiSigActionHash, nonce: NONCE, signatureChainId, isTestnet: false }) as never,
    );

    // The bytes-level capability took both signatures; the outer one carries viem's exact digest…
    expect(hexSignCalls).toBe(0);
    expect(digests.length).toBe(2);
    expect(`0x${bytesToHex(digests[1])}`, "outer digest bytes").toBe(oracle);
    // …and the resulting outer signature equals what signing that digest with viem produces.
    const oracleHex = await account.sign({ hash: oracle });
    expect(`${signature.r.slice(2)}${signature.s.slice(2)}${signature.v.toString(16)}`).toBe(oracleHex.slice(2));
  });
});

// --- User-signed flow: signature conformance --------------------

describe("signMultiSigUserSigned() fast path", () => {
  test("is byte-identical to the typed-data path across signer sets x chain IDs x users x networks", async () => {
    for (const signerCount of [1, 3, 11] as const) {
      const signers = toSigners(ELEVEN_KEYS.slice(0, signerCount));
      const oracleSigners = signers.map(stripped) as [ReturnType<typeof stripped>, ...ReturnType<typeof stripped>[]];
      for (const signatureChainId of ["0x66eee", "0x1"] as const) {
        for (const multiSigUser of MULTI_SIG_USERS) {
          for (const hyperliquidChain of ["Mainnet", "Testnet"] as const) {
            const args = {
              multiSigUser,
              action: approveAgentAction(signatureChainId, hyperliquidChain),
              types: APPROVE_AGENT_TYPES,
            } as const;
            const fast = await signMultiSigUserSigned({ signers, ...args });
            const oracle = await signMultiSigUserSigned({ signers: oracleSigners, ...args });
            const context = `${signerCount} signers / ${signatureChainId} / ${multiSigUser.slice(0, 10)} / ${hyperliquidChain}`;
            expect(fast, context).toEqual(oracle);
          }
        }
      }
    }
  });

  test("routes only the inner signature through signTypedData; the outer uses the digest", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    const signedDigests: `0x${string}`[] = [];
    let typedDataCalls = 0;
    const wallet = {
      address: account.address,
      sign: (args: { hash: `0x${string}` }) => {
        signedDigests.push(args.hash);
        return account.sign(args);
      },
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
    };
    const signatureChainId = "0x66eee";

    const { action: wrapper } = await signMultiSigUserSigned({
      signers: [wallet],
      multiSigUser: MULTI_SIG_USERS[0],
      action: approveAgentAction(signatureChainId, "Testnet"),
      types: APPROVE_AGENT_TYPES,
    });

    // Inner: one typed-data signature (user-signed actions have no digest fast path).
    // Outer: one raw-digest signature over exactly viem's SendMultiSig digest.
    const { type: _, ...wrapperWithoutType } = wrapper;
    const multiSigActionHash = createL1ActionHash({ action: wrapperWithoutType, nonce: NONCE });
    const oracle = hashTypedData(
      oracleTypedData({ multiSigActionHash, nonce: NONCE, signatureChainId, isTestnet: true }) as never,
    );
    expect(typedDataCalls).toBe(1);
    expect(signedDigests).toEqual([oracle]);
  });
});
