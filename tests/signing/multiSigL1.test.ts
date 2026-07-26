/**
 * Differential tests for the multi-sig L1 adjusted-subtree reuse (issue #10).
 *
 * `signMultiSigL1` hashes the same action twice — once in the inner payload every signer
 * signs, once in the outer wrapper the leader signs. The action is now adjusted once and the
 * adjusted subtree reused across both preimages (`preadjustL1Action` in `src/signing/_l1.ts`)
 * instead of being re-traversed per hash. The reuse must not move a single byte, so this file
 * pins it two ways, in the style of `fastDigest.test.ts`:
 *
 * 1. Hash level: a preimage containing the marker hashes identically to the same preimage
 *    containing the raw action, across actions that force `adjust` to rebuild (uint64-range
 *    integers widened to `BigInt`, dropped `undefined` keys) and across hash modifiers.
 * 2. Flow level: the full `signMultiSigL1` output (wrapper + leader signature) is compared
 *    against an independently reimplemented pre-change orchestration that hashes the raw
 *    action in both preimages. Signatures are deterministic (RFC 6979), so equality is exact.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import { createL1ActionHash, signMultiSigL1 } from "@bloxwap/hyperliquid/signing";
import {
  type AbstractWallet,
  getWalletAddress,
  type Signature,
  signTypedData,
} from "../../src/signing/_abstractWallet.ts";
import { preadjustL1Action, signL1Inner } from "../../src/signing/_l1.ts";

// --- Fixtures ------------------------------------------------

const PRIVATE_KEYS = [
  "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
] as const;

const MULTI_SIG_USER = "0x1234567890123456789012345678901234567890" as const;
const SIGNER = "0xe5ca49fb3bd9a581f0d1ef9cb5d7177da08bf901" as const;
const SIGNATURE_CHAIN_ID = "0x66eee" as const;
const NONCE = 1700000000000;
const VAULT = "0x1234567890123456789012345678901234567890" as const;
const EXPIRES = 1700000005000;

const ORDER = {
  type: "order",
  orders: [{ a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
} as const;

/** Actions chosen to exercise every `adjust` outcome: pass-through, rebuild, and widen. */
const ACTIONS: readonly [label: string, action: Record<string, unknown> | unknown[]][] = [
  ["order (pass-through)", ORDER],
  // `time` exceeds uint32: adjust widens it to BigInt, so the adjusted subtree differs by
  // reference from the raw action — the case the reuse must reproduce exactly.
  ["scheduleCancel (int64 widening)", { type: "scheduleCancel", time: 1700000060000 }],
  ["cancel with uint64 oid (int64 widening)", { type: "cancel", cancels: [{ a: 0, o: 4294967296 }] }],
  // `undefined` values are dropped by adjust, changing the key set of the hashed object.
  ["undefined property dropped", { type: "scheduleCancel", time: undefined }],
  [
    "batch of 20 orders",
    {
      type: "order",
      orders: Array.from({ length: 20 }, (_, i) => ({
        a: i,
        b: i % 2 === 0,
        p: "30000",
        s: "0.001",
        r: false,
        t: { limit: { tif: "Gtc" } },
      })),
      grouping: "na",
    },
  ],
  ["array action", [{ type: "cancel", cancels: [{ a: 0, o: 42 }] }]],
];

const MODIFIERS: readonly { vaultAddress?: `0x${string}`; expiresAfter?: number }[] = [
  {},
  { vaultAddress: VAULT },
  { expiresAfter: EXPIRES },
  { vaultAddress: VAULT, expiresAfter: EXPIRES },
];

// --- Oracle: the pre-change orchestration ---------------------

/** EIP-712 types of the multi-sig outer wrapper (mirrors `MULTI_SIG_TYPES` in `_multiSig.ts`). */
const MULTI_SIG_TYPES = {
  "HyperliquidTransaction:SendMultiSig": [
    { name: "hyperliquidChain", type: "string" },
    { name: "multiSigActionHash", type: "bytes32" },
    { name: "nonce", type: "uint64" },
  ],
};

/** The wrapper shape `signMultiSigL1` returns (its `MultiSigAction` interface is not exported). */
type MultiSigWrapper = Awaited<ReturnType<typeof signMultiSigL1>>["action"];

/**
 * `signMultiSigL1` as it ran before the adjusted-subtree reuse: the RAW action sits in both
 * hash preimages, so `adjust` traverses it once for the inner hash and again for the outer.
 * Rebuilt from the documented wire layout; the known-answer fixtures in `mod.test.ts` pin this
 * shape independently.
 */
async function oracleSignMultiSigL1(args: {
  signers: readonly [AbstractWallet, ...AbstractWallet[]];
  multiSigUser: `0x${string}`;
  signatureChainId: `0x${string}`;
  action: Record<string, unknown> | unknown[];
  nonce: number;
  isTestnet?: boolean;
  vaultAddress?: `0x${string}`;
  expiresAfter?: number;
}): Promise<{ action: MultiSigWrapper; signature: Signature }> {
  const outerSigner = await getWalletAddress(args.signers[0]);

  const innerActionHash = createL1ActionHash({
    action: [args.multiSigUser.toLowerCase(), outerSigner.toLowerCase(), args.action],
    nonce: args.nonce,
    vaultAddress: args.vaultAddress,
    expiresAfter: args.expiresAfter,
  });

  const innerSignatures = await Promise.all(
    args.signers.map((signer) => signL1Inner({ signer, actionHash: innerActionHash, isTestnet: args.isTestnet })),
  );

  const wrapper: MultiSigWrapper = {
    type: "multiSig",
    signatureChainId: args.signatureChainId,
    signatures: innerSignatures,
    payload: {
      multiSigUser: args.multiSigUser.toLowerCase() as `0x${string}`,
      outerSigner,
      action: args.action,
    },
  };

  const { type: _, ...wrapperWithoutType } = wrapper;
  const multiSigActionHash = createL1ActionHash({
    action: wrapperWithoutType,
    nonce: args.nonce,
    vaultAddress: args.vaultAddress,
    expiresAfter: args.expiresAfter,
  });

  const signature = await signTypedData({
    wallet: args.signers[0],
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: parseInt(args.signatureChainId, 16),
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: MULTI_SIG_TYPES,
    primaryType: "HyperliquidTransaction:SendMultiSig",
    message: {
      hyperliquidChain: args.isTestnet ? "Testnet" : "Mainnet",
      multiSigActionHash,
      nonce: args.nonce,
    },
  });

  return { action: wrapper, signature };
}

// --- Hash-level byte equality ---------------------------------

describe("preadjustL1Action()", () => {
  test("hashes byte-identically to the raw action inside the inner-payload preimage", () => {
    for (const [label, action] of ACTIONS) {
      for (const modifiers of MODIFIERS) {
        const raw = createL1ActionHash({
          action: [MULTI_SIG_USER, SIGNER, action],
          nonce: NONCE,
          ...modifiers,
        });
        const marked = createL1ActionHash({
          action: [MULTI_SIG_USER, SIGNER, preadjustL1Action(action)],
          nonce: NONCE,
          ...modifiers,
        });

        expect(marked, `${label} / ${JSON.stringify(modifiers)}`).toBe(raw);
      }
    }
  });

  test("hashes byte-identically to the raw action inside the outer-wrapper preimage", () => {
    // Same nesting the outer hash sees: `payload.action` holds the marker instead of the action.
    for (const [label, action] of ACTIONS) {
      const rawWrapper = {
        signatureChainId: SIGNATURE_CHAIN_ID,
        signatures: [{ r: "0x12", s: "0x34", v: 27 }],
        payload: { multiSigUser: MULTI_SIG_USER, outerSigner: SIGNER, action },
      };
      const markedWrapper = {
        ...rawWrapper,
        payload: { ...rawWrapper.payload, action: preadjustL1Action(action) },
      };

      expect(createL1ActionHash({ action: markedWrapper, nonce: NONCE }), label).toBe(
        createL1ActionHash({ action: rawWrapper, nonce: NONCE }),
      );
    }
  });
});

// --- Flow-level differential ----------------------------------

describe("signMultiSigL1() with adjusted-subtree reuse", () => {
  const signers = PRIVATE_KEYS.map((key) => privateKeyToAccount(key)) as [
    ReturnType<typeof privateKeyToAccount>,
    ...ReturnType<typeof privateKeyToAccount>[],
  ];

  test("is byte-identical to the pre-change orchestration", async () => {
    for (const [label, action] of ACTIONS) {
      for (const modifiers of MODIFIERS) {
        for (const isTestnet of [false, true]) {
          const args = {
            multiSigUser: MULTI_SIG_USER,
            signatureChainId: SIGNATURE_CHAIN_ID,
            action,
            nonce: NONCE,
            isTestnet,
            ...modifiers,
          };

          const actual = await signMultiSigL1({ signers, ...args });
          const oracle = await oracleSignMultiSigL1({ signers, ...args });

          expect(actual, `${label} / ${JSON.stringify(modifiers)} / ${isTestnet}`).toEqual(oracle);
        }
      }
    }
  });

  test("keeps the caller's own action object in the wire wrapper", async () => {
    // The adjusted subtree is an implementation detail of the preimages; the returned wrapper
    // is what gets `JSON.stringify`d onto the wire, so it must carry the original action.
    const action = { type: "cancel", cancels: [{ a: 0, o: 42 }] };

    const result = await signMultiSigL1({
      signers,
      multiSigUser: MULTI_SIG_USER,
      signatureChainId: SIGNATURE_CHAIN_ID,
      action,
      nonce: NONCE,
    });

    expect(result.action.payload.action).toBe(action);
    expect(JSON.parse(JSON.stringify(result.action))).toEqual(result.action);
  });
});
