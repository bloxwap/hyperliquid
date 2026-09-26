/**
 * Differential conformance tests for the hand-rolled L1 `Agent` digest fast path.
 *
 * `src/signing/_fastDigest.ts` replaces viem's generic EIP-712 encoding on the L1 signing hot path, and
 * the digest it produces is signed — a single differing byte would authorize a payload the user never
 * approved. So viem is kept as the oracle here: for a matrix of private keys x mainnet/testnet x actions,
 * the fast path's digest and final signature (r, s, v) must be byte-identical to the typed-data path.
 * The precomputed constants are additionally pinned to literals captured from viem's `hashTypedData`.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createL1ActionHash, signL1Action, signMultiSigL1 } from "@bloxwap/hyperliquid/signing";
import { createL1AgentDigest } from "../../src/signing/_fastDigest.ts";

// --- Oracle typed data -----------------------------------------

/** Mirrors `L1_DOMAIN` / `L1_AGENT_TYPES` in `src/signing/_l1.ts`, with `EIP712Domain` as viem expects it. */
function oracleTypedData(actionHash: `0x${string}`, isTestnet: boolean) {
  return {
    domain: {
      name: "Exchange",
      version: "1",
      chainId: 1337,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    message: {
      source: isTestnet ? "b" : "a",
      connectionId: actionHash,
    },
  } as const;
}

// --- Fixtures --------------------------------------------------

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
const SCHEDULE_CANCEL_NULL = { type: "scheduleCancel", time: null } as const;

/** Every combination of action x hash modifiers the L1 path can produce. */
const CASES: readonly { label: string; action: Record<string, unknown>; vault?: `0x${string}`; expires?: number }[] = [
  { label: "order with cloid", action: ORDER_WITH_CLOID },
  { label: "order with cloid + vault", action: ORDER_WITH_CLOID, vault: VAULT },
  { label: "order with cloid + expiry", action: ORDER_WITH_CLOID, expires: EXPIRES },
  { label: "order with cloid + vault + expiry", action: ORDER_WITH_CLOID, vault: VAULT, expires: EXPIRES },
  { label: "cancel", action: CANCEL },
  { label: "cancelByCloid", action: CANCEL_BY_CLOID },
  { label: "scheduleCancel", action: SCHEDULE_CANCEL },
  { label: "scheduleCancel (null time)", action: SCHEDULE_CANCEL_NULL },
];

// --- Digest conformance ----------------------------------------

describe("createL1AgentDigest()", () => {
  test("matches viem hashTypedData across actions x networks", () => {
    for (const { label, action, vault, expires } of CASES) {
      const actionHash = createL1ActionHash({
        action,
        nonce: NONCE,
        vaultAddress: vault,
        expiresAfter: expires,
      });
      for (const isTestnet of [false, true]) {
        const oracle = hashTypedData(oracleTypedData(actionHash, isTestnet) as never);
        expect(createL1AgentDigest(actionHash, isTestnet), `${label} / ${isTestnet ? "testnet" : "mainnet"}`).toBe(
          oracle,
        );
      }
    }
  });

  test("keeps the known-good digests (pins the precomputed constants)", () => {
    // Captured from viem `hashTypedData`; a wrong typehash, domain separator, or source hash breaks these.
    const actionHash = "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d";
    expect(createL1AgentDigest(actionHash, false)).toBe(
      "0xcf97446596762e207bece6115520a233d4cec3c8f22c5193a633baa610233d8e",
    );
    expect(createL1AgentDigest(actionHash, true)).toBe(
      "0x9e83d71366d4323b7c4830d17c68f71fb730ce3b2edf19e5110c0712140c9931",
    );
  });
});

// --- Signature conformance -------------------------------------

describe("signL1Action() fast path", () => {
  test("is byte-identical to viem signTypedData across keys x actions x networks", async () => {
    for (const privateKey of PRIVATE_KEYS) {
      const wallet = privateKeyToAccount(privateKey);
      for (const { label, action, vault, expires } of CASES) {
        for (const isTestnet of [false, true]) {
          const fast = await signL1Action({
            wallet,
            action: { ...action },
            nonce: NONCE,
            isTestnet,
            vaultAddress: vault,
            expiresAfter: expires,
          });
          const oracleHex = await wallet.signTypedData(
            oracleTypedData(
              createL1ActionHash({ action, nonce: NONCE, vaultAddress: vault, expiresAfter: expires }),
              isTestnet,
            ) as never,
          );
          const context = `${privateKey.slice(0, 10)} / ${label} / ${isTestnet ? "testnet" : "mainnet"}`;
          expect(fast.r, `r ${context}`).toBe(`0x${oracleHex.slice(2, 66)}`);
          expect(fast.s, `s ${context}`).toBe(`0x${oracleHex.slice(66, 130)}`);
          expect(fast.v, `v ${context}`).toBe(parseInt(oracleHex.slice(130, 132), 16) as 27 | 28);
        }
      }
    }
  });

  test("actually engages the raw-digest path on a viem local account", async () => {
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

    await signL1Action({ wallet, action: { ...CANCEL }, nonce: NONCE });

    expect(signCalls).toBe(1);
    expect(typedDataCalls).toBe(0);
  });

  test("falls back to signTypedData for a local account without raw-digest signing", async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS[0]);
    let typedDataCalls = 0;
    // Same local account, but with `sign` stripped: only `address` + `signTypedData` remain.
    const wallet = {
      address: account.address,
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
    };

    const fallback = await signL1Action({ wallet, action: { ...CANCEL }, nonce: NONCE, isTestnet: true });
    const fast = await signL1Action({ wallet: account, action: { ...CANCEL }, nonce: NONCE, isTestnet: true });

    expect(typedDataCalls).toBe(1);
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

    const jsonRpc = await signL1Action({ wallet, action: { ...CANCEL }, nonce: NONCE });
    const oracle = await account.signTypedData(
      oracleTypedData(createL1ActionHash({ action: CANCEL, nonce: NONCE }), false) as never,
    );

    expect(typedDataCalls).toBe(1);
    expect(`${jsonRpc.r.slice(2)}${jsonRpc.s.slice(2)}${jsonRpc.v.toString(16)}`).toBe(oracle.slice(2));
  });

  test("keeps multi-sig inner signatures byte-identical to the typed-data path", async () => {
    const signers = PRIVATE_KEYS.slice(0, 3).map((key) => privateKeyToAccount(key));
    const stripped = signers.map((account) => ({
      address: account.address,
      signTypedData: (params: never) => account.signTypedData(params),
    }));
    const args = {
      multiSigUser: "0x1234567890123456789012345678901234567890",
      signatureChainId: "0x66eee",
      action: { ...ORDER_WITH_CLOID },
      nonce: NONCE,
      isTestnet: true,
    } as const;

    const fast = await signMultiSigL1({ signers: [signers[0], signers[1], signers[2]], ...args });
    const oracle = await signMultiSigL1({ signers: [stripped[0], stripped[1], stripped[2]], ...args });

    expect(fast).toEqual(oracle);
  });
});

// --- adjust() own-key guarantee --------------------------------

describe("createL1ActionHash() adjust()", () => {
  test("ignores inherited enumerable properties", () => {
    // The msgpack encoder hashes own enumerable keys (`Object.keys`). `adjust` previously rebuilt objects
    // with `for...in`, which walks the prototype chain and would promote `inherited` into the hashed bytes.
    const proto = { inherited: "pollution" };
    const action = Object.assign(Object.create(proto), { type: "cancel", cancels: [{ a: 0, o: 42 }] });

    expect(createL1ActionHash({ action, nonce: NONCE })).toBe(
      createL1ActionHash({ action: { type: "cancel", cancels: [{ a: 0, o: 42 }] }, nonce: NONCE }),
    );
  });

  test("keeps byte output unchanged for plain objects (known-answer)", () => {
    // Same pin as tests/signing/msgpack.test.ts: the adjust rewrite must not move a single byte.
    expect(createL1ActionHash({ action: ORDER_WITH_CLOID, nonce: NONCE })).toBe(
      "0x124a730fa73e0369fa3cb2183bc6cce521491bee320b80d4b7a2062dd0f11578",
    );
  });

  test("matches the plain-object hash for a class instance with own fields", () => {
    class CancelAction {
      type = "cancel";
      cancels = [{ a: 0, o: 42 }];
    }

    expect(createL1ActionHash({ action: new CancelAction() as unknown as Record<string, unknown>, nonce: NONCE })).toBe(
      createL1ActionHash({ action: { type: "cancel", cancels: [{ a: 0, o: 42 }] }, nonce: NONCE }),
    );
  });
});
