/**
 * Signing-path CPU cost: the work every exchange transaction pays before a byte leaves the process.
 *
 * These scenarios call the signing primitives directly (no transport, no client), so a
 * change here is attributable to one function rather than to end-to-end plumbing.
 * The end-to-end view lives in `scenarios/transaction.ts`.
 *
 * Batch sizes 1 and 100 are both measured because several costs in this path scale with
 * the number of orders in the action (msgpack encoding, canonicalization, the `adjust`
 * traversal), and a per-order regression is invisible at batch size 1.
 * @module
 */

import { privateKeyToAccount } from "viem/accounts";
import { ApproveAgentTypes, OrderRequest } from "@bloxwap/hyperliquid/api/exchange";
import {
  canonicalize,
  createL1ActionHash,
  signL1Action,
  signMultiSigL1,
  signMultiSigUserSigned,
} from "@bloxwap/hyperliquid/signing";
import { scenario } from "../_harness.ts";
import { TEST_PRIVATE_KEY } from "../_helpers.ts";

/** Extra keys used by the multi-sig signers, so each has a distinct address. */
const EXTRA_KEYS = [
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

/** A single order, shaped exactly as it goes over the wire. */
function order(i: number): Record<string, unknown> {
  return {
    a: i % 200,
    b: i % 2 === 0,
    p: "30000",
    s: "0.001",
    r: false,
    t: { limit: { tif: "Gtc" } },
  };
}

/** An `order` action carrying `count` orders. */
function orderAction(count: number): Record<string, unknown> {
  return {
    type: "order",
    orders: Array.from({ length: count }, (_, i) => order(i)),
    grouping: "na",
  };
}

const NONCE = 1700000000000;

// --- Canonicalization ------------------------------------------------------
// `canonicalize` rebuilds the whole action tree in schema key order. Issues #8 and #11
// concern this function; these scenarios are how a change to it is measured.

for (const count of [1, 100] as const) {
  scenario({
    name: `signing/canonicalize_order_${count}`,
    group: "signing",
    description: `canonicalize() over an order action with ${count} order(s)`,
    unit: "order",
    unitsPerIteration: count,
    iterations: count === 1 ? 2000 : 100,
    setup: () => ({ action: orderAction(count) }),
    run: ({ action }: { action: Record<string, unknown> }) => {
      canonicalize(OrderRequest.entries.action, action);
    },
  });
}

// --- Action hashing --------------------------------------------------------
// `createL1ActionHash` = `adjust` traversal + msgpack encode + keccak256. Issue #4
// (msgpack allocation churn) and issue #10 (double encode for multi-sig) live here.

for (const count of [1, 100] as const) {
  scenario({
    name: `signing/l1_action_hash_order_${count}`,
    group: "signing",
    description: `createL1ActionHash() over an order action with ${count} order(s)`,
    unit: "order",
    unitsPerIteration: count,
    iterations: count === 1 ? 2000 : 100,
    setup: () => ({ action: orderAction(count) }),
    run: ({ action }: { action: Record<string, unknown> }) => {
      createL1ActionHash({ action, nonce: NONCE });
    },
  });
}

scenario({
  name: "signing/l1_action_hash_with_vault_and_expiry",
  group: "signing",
  description: "createL1ActionHash() with vaultAddress and expiresAfter set (longest hash preimage)",
  unit: "hash",
  iterations: 2000,
  setup: () => ({ action: orderAction(1) }),
  run: ({ action }: { action: Record<string, unknown> }) => {
    createL1ActionHash({
      action,
      nonce: NONCE,
      vaultAddress: "0x1234567890123456789012345678901234567890",
      expiresAfter: NONCE + 60_000,
    });
  },
});

// --- Full L1 signing ------------------------------------------------------
// Adds secp256k1 ECDSA over the hash. The signature dominates at batch size 1, which is
// why the hash and canonicalize scenarios above are measured separately.

for (const count of [1, 100] as const) {
  scenario({
    name: `signing/sign_l1_action_order_${count}`,
    group: "signing",
    description: `signL1Action() end to end (hash + EIP-712 ECDSA) with ${count} order(s)`,
    unit: "order",
    unitsPerIteration: count,
    iterations: count === 1 ? 50 : 10,
    samples: 10,
    setup: () => ({
      wallet: privateKeyToAccount(TEST_PRIVATE_KEY),
      action: orderAction(count),
    }),
    run: async ({ wallet, action }: { wallet: ReturnType<typeof privateKeyToAccount>; action: object }) => {
      await signL1Action({ wallet, action: action as Record<string, unknown>, nonce: NONCE, isTestnet: true });
    },
  });
}

// --- Multi-sig -----------------------------------------------------------
// Three signers: the inner payload is hashed once per signer plus once for the outer
// wrapper. Issues #9 and #10 are about removing that duplicated work.

scenario({
  name: "signing/multisig_l1_3_signers",
  group: "signing",
  description: "signMultiSigL1() with 3 signers over a 1-order action (inner hashes + outer wrapper)",
  unit: "request",
  iterations: 10,
  samples: 10,
  setup: () => ({
    signers: [
      privateKeyToAccount(TEST_PRIVATE_KEY),
      privateKeyToAccount(EXTRA_KEYS[0]),
      privateKeyToAccount(EXTRA_KEYS[1]),
    ] as [ReturnType<typeof privateKeyToAccount>, ...ReturnType<typeof privateKeyToAccount>[]],
    action: orderAction(1),
  }),
  run: async ({
    signers,
    action,
  }: {
    signers: [ReturnType<typeof privateKeyToAccount>, ...ReturnType<typeof privateKeyToAccount>[]];
    action: Record<string, unknown>;
  }) => {
    await signMultiSigL1({
      signers,
      multiSigUser: "0x1234567890123456789012345678901234567890",
      signatureChainId: "0x66eee",
      action,
      nonce: NONCE,
      isTestnet: true,
    });
  },
});

// The user-signed multi-sig path injects `payloadMultiSigUser`/`outerSigner` into the EIP-712 type
// before every inner signature. Issue #9 is about doing that type surgery once instead of once per
// signer, which only shows up with more than one signer — hence three.

scenario({
  name: "signing/multisig_user_signed_3_signers",
  group: "signing",
  description: "signMultiSigUserSigned() with 3 signers over an approveAgent action (type injection + inner ECDSA)",
  unit: "request",
  iterations: 10,
  samples: 10,
  setup: () => ({
    signers: [
      privateKeyToAccount(TEST_PRIVATE_KEY),
      privateKeyToAccount(EXTRA_KEYS[0]),
      privateKeyToAccount(EXTRA_KEYS[1]),
    ] as [ReturnType<typeof privateKeyToAccount>, ...ReturnType<typeof privateKeyToAccount>[]],
  }),
  run: async ({
    signers,
  }: {
    signers: [ReturnType<typeof privateKeyToAccount>, ...ReturnType<typeof privateKeyToAccount>[]];
  }) => {
    await signMultiSigUserSigned({
      signers,
      multiSigUser: "0x1234567890123456789012345678901234567890",
      action: {
        type: "approveAgent",
        signatureChainId: "0x66eee",
        hyperliquidChain: "Testnet",
        agentAddress: "0x0000000000000000000000000000000000000001",
        agentName: "Agent",
        nonce: NONCE,
      },
      types: ApproveAgentTypes,
    });
  },
});

/**
 * A viem-local-shaped wallet that returns a fixed signature without touching the curve.
 *
 * secp256k1 costs ~150 µs per signature, so in a 3-signer multi-sig it accounts for well over 99%
 * of the wall clock and any change to the SDK-side orchestration is below the noise floor. Stubbing
 * the curve out leaves exactly the library's own cost — EIP-712 type surgery, message filtering,
 * wrapper hashing — on the clock, which is what issues #9 and #10 are about.
 */
function stubWallet(address: `0x${string}`): {
  address: `0x${string}`;
  signTypedData: (params: unknown) => Promise<`0x${string}`>;
} {
  const signature = `0x${"11".repeat(64)}1b` as `0x${string}`;
  return { address, signTypedData: (_params: unknown) => Promise.resolve(signature) };
}

scenario({
  name: "signing/multisig_user_signed_3_signers_no_ecdsa",
  group: "signing",
  description: "signMultiSigUserSigned() with 3 stub signers: SDK-side multi-sig overhead without secp256k1",
  unit: "request",
  iterations: 200,
  samples: 15,
  setup: () => ({
    signers: [
      stubWallet("0x1111111111111111111111111111111111111111"),
      stubWallet("0x2222222222222222222222222222222222222222"),
      stubWallet("0x3333333333333333333333333333333333333333"),
    ] as [ReturnType<typeof stubWallet>, ...ReturnType<typeof stubWallet>[]],
  }),
  run: async ({ signers }: { signers: [ReturnType<typeof stubWallet>, ...ReturnType<typeof stubWallet>[]] }) => {
    await signMultiSigUserSigned({
      signers,
      multiSigUser: "0x1234567890123456789012345678901234567890",
      action: {
        type: "approveAgent",
        signatureChainId: "0x66eee",
        hyperliquidChain: "Testnet",
        agentAddress: "0x0000000000000000000000000000000000000001",
        agentName: "Agent",
        nonce: NONCE,
      },
      types: ApproveAgentTypes,
    });
  },
});
