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
import { hashTypedData } from "viem";
import * as v from "valibot";
import { ExchangeClient } from "@bloxwap/hyperliquid";
import { ApproveAgentTypes, OrderRequest } from "@bloxwap/hyperliquid/api/exchange";
import {
  canonicalize,
  createL1ActionHash,
  signL1Action,
  signMultiSigL1,
  signMultiSigUserSigned,
} from "@bloxwap/hyperliquid/signing";
import { parse } from "../../../src/_base.ts";
import { createL1AgentDigest, createMultiSigDigest } from "../../../src/signing/_fastDigest.ts";
import { scenario } from "../_harness.ts";
import { MockExchangeTransport, TEST_PRIVATE_KEY } from "../_helpers.ts";

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

// The chain as every exchange method actually runs it: `canonicalize(Schema, parse(Schema, …))`.
// Issue #8 makes the second pass allocation-free on `parse` output, so the delta versus the two
// scenarios above isolates what the fast path saves inside the full chain.
const OrderActionSchema = v.object(OrderRequest.entries.action.entries);

scenario({
  name: "signing/parse_canonicalize_order_100",
  group: "signing",
  description: "parse() + canonicalize() over a 100-order action, as the exchange methods run it",
  unit: "order",
  unitsPerIteration: 100,
  iterations: 50,
  setup: () => ({ params: { orders: orderAction(100).orders, grouping: "na" } }),
  run: ({ params }: { params: Record<string, unknown> }) => {
    canonicalize(OrderActionSchema, parse(OrderActionSchema, { type: "order", ...params }));
  },
});

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

// The L1 multi-sig counterpart, on a 20-order action: large enough that the action-tree
// traversal (issue #10 reuses the adjusted subtree across the inner and outer hashes instead
// of traversing twice) is visible above the noise floor. The stub carries the raw-digest
// `sign` that viem local accounts expose, so the inner signatures take the fast digest path.
scenario({
  name: "signing/multisig_l1_3_signers_no_ecdsa",
  group: "signing",
  description: "signMultiSigL1() with 3 stub signers over a 20-order action: SDK-side overhead without secp256k1",
  unit: "request",
  iterations: 200,
  samples: 15,
  setup: () => ({
    signers: [
      digestStubWallet("0x1111111111111111111111111111111111111111"),
      digestStubWallet("0x2222222222222222222222222222222222222222"),
      digestStubWallet("0x3333333333333333333333333333333333333333"),
    ] as [ReturnType<typeof digestStubWallet>, ...ReturnType<typeof digestStubWallet>[]],
    action: orderAction(20),
  }),
  run: async ({
    signers,
    action,
  }: {
    signers: [ReturnType<typeof digestStubWallet>, ...ReturnType<typeof digestStubWallet>[]];
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

// --- EIP-712 Agent digest ---------------------------------------------------
// The fixed L1 `Agent` shape lets the digest be hand-rolled from precomputed constants
// (`createL1AgentDigest`) instead of viem's generic `hashTypedData`. The pair is measured
// side by side so the saving stays visible in the report; byte-equality is pinned by
// `tests/signing/fastDigest.test.ts`, not here.

const AGENT_ACTION_HASH = "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d" as const;

/** The typed-data envelope viem's `hashTypedData` is benchmarked on (testnet `source`). */
const AGENT_TYPED_DATA = {
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
  message: { source: "b", connectionId: AGENT_ACTION_HASH },
} as const;

scenario({
  name: "signing/eip712_agent_digest",
  group: "signing",
  description: "createL1AgentDigest(): hand-rolled EIP-712 digest of the fixed L1 Agent message",
  unit: "digest",
  iterations: 5000,
  run: () => {
    createL1AgentDigest(AGENT_ACTION_HASH, true);
  },
});

scenario({
  name: "signing/eip712_agent_digest_viem",
  group: "signing",
  description: "viem hashTypedData() over the same L1 Agent message (the oracle the fast digest replaces)",
  unit: "digest",
  iterations: 2000,
  run: () => {
    hashTypedData(AGENT_TYPED_DATA as never);
  },
});

// --- EIP-712 multi-sig outer digest ------------------------------------------
// Same treatment as the Agent digest above: the fixed `HyperliquidTransaction:SendMultiSig`
// shape lets the outer multi-sig signature use a hand-rolled digest (`createMultiSigDigest`,
// domain separator cached per signatureChainId) instead of viem's generic `hashTypedData`.
// Byte-equality is pinned by `tests/signing/multiSigDigest.test.ts`, not here.

const MULTI_SIG_ACTION_HASH = "0x27015072154fc147842efc672ab345311190856b5143f4b2def65830657fb15d" as const;

/** The typed-data envelope viem's `hashTypedData` is benchmarked on (testnet `hyperliquidChain`). */
const MULTI_SIG_TYPED_DATA = {
  domain: {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: 0x66eee,
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
  message: { hyperliquidChain: "Testnet", multiSigActionHash: MULTI_SIG_ACTION_HASH, nonce: NONCE },
} as const;

scenario({
  name: "signing/eip712_multisig_digest",
  group: "signing",
  description: "createMultiSigDigest(): hand-rolled EIP-712 digest of the fixed SendMultiSig outer message",
  unit: "digest",
  iterations: 5000,
  run: () => {
    createMultiSigDigest(MULTI_SIG_ACTION_HASH, NONCE, "0x66eee", true);
  },
});

scenario({
  name: "signing/eip712_multisig_digest_viem",
  group: "signing",
  description: "viem hashTypedData() over the same SendMultiSig message (the oracle the fast digest replaces)",
  unit: "digest",
  iterations: 2000,
  run: () => {
    hashTypedData(MULTI_SIG_TYPED_DATA as never);
  },
});

// --- End-to-end order without ECDSA -----------------------------------------
// secp256k1 dominates `client.order` (~85 µs of ~147 µs), which masks the SDK's own plumbing
// cost — validation, nonce, action hashing, digest, dispatch. Stubbing the curve out (a fixed
// signature, same shape as `stubWallet` above but with the raw-digest `sign` a viem local
// account carries) leaves exactly that shell on the clock.

/** A viem-local-shaped wallet whose `sign` returns a fixed signature without touching the curve. */
function digestStubWallet(address: `0x${string}`): {
  address: `0x${string}`;
  sign: (args: { hash: `0x${string}` }) => Promise<`0x${string}`>;
  signTypedData: (params: unknown) => Promise<`0x${string}`>;
} {
  const signature = `0x${"11".repeat(64)}1b` as `0x${string}`;
  return {
    address,
    sign: (_args: { hash: `0x${string}` }) => Promise.resolve(signature),
    signTypedData: (_params: unknown) => Promise.resolve(signature),
  };
}

scenario({
  name: "signing/order_e2e_no_ecdsa",
  group: "signing",
  description: "ExchangeClient.order() with a stub wallet (fixed signature): SDK shell overhead without secp256k1",
  unit: "order",
  iterations: 200,
  samples: 15,
  setup: () => {
    const transport = new MockExchangeTransport(0);
    const client = new ExchangeClient({
      transport,
      wallet: digestStubWallet("0x1111111111111111111111111111111111111111"),
    });
    return { client };
  },
  run: async ({ client }: { client: ExchangeClient }) => {
    await client.order({
      orders: [{ a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
      grouping: "na",
    });
  },
});

// --- WASM secp256k1 -------------------------------------------------------------
// `createFastLocalWallet` (issue #13) swaps noble's pure-JS secp256k1 for tiny-secp256k1
// (WASM libsecp256k1) on the raw-digest `sign` the L1 path uses — the opt-in counterpart of
// `sign_l1_action_order_1` above. Byte-identity of the signature is pinned by
// `tests/signing/fastWallet.test.ts`, not here. The scenario registers only when the optional
// dependency is installed, so a checkout without it skips the scenario cleanly. (The import
// declaration is hoisted; keeping it next to the scenario keeps this file append-only.)

import { type AbstractViemLocalAccount, createFastLocalWallet } from "@bloxwap/hyperliquid/signing";

const tinySecp256k1Available = await import("tiny-secp256k1").then(
  () => true,
  () => false,
);

if (tinySecp256k1Available) {
  scenario({
    name: "signing/sign_l1_action_order_1_wasm",
    group: "signing",
    description:
      "signL1Action() with a createFastLocalWallet() wallet (WASM tiny-secp256k1 secp256k1); opt-in counterpart of sign_l1_action_order_1",
    unit: "order",
    unitsPerIteration: 1,
    iterations: 50,
    samples: 10,
    setup: async () => ({
      wallet: await createFastLocalWallet(TEST_PRIVATE_KEY),
      action: orderAction(1),
    }),
    run: async ({ wallet, action }: { wallet: AbstractViemLocalAccount; action: object }) => {
      await signL1Action({ wallet, action: action as Record<string, unknown>, nonce: NONCE, isTestnet: true });
    },
  });
}

// --- Skip-validation fast path (issue #28) -----------------------------------
// Unchecked counterpart of `signing/order_e2e_no_ecdsa` above: with the curve stubbed out, the
// delta between the two scenarios is exactly the valibot parse + canonicalize pass (plus the
// request-option validation in the execute path) that `skipValidation: true` opts out of.

scenario({
  name: "signing/order_e2e_no_ecdsa_unchecked",
  group: "signing",
  description:
    "ExchangeClient.order() with a stub wallet and skipValidation: true: SDK shell overhead without secp256k1 or validation",
  unit: "order",
  iterations: 200,
  samples: 15,
  setup: () => {
    const transport = new MockExchangeTransport(0);
    const client = new ExchangeClient({
      transport,
      wallet: digestStubWallet("0x1111111111111111111111111111111111111111"),
    });
    return { client };
  },
  run: async ({ client }: { client: ExchangeClient }) => {
    await client.order(
      { orders: [{ a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }], grouping: "na" },
      { skipValidation: true },
    );
  },
});

// --- WASM keccak -------------------------------------------------------------
// `_keccak.ts` swaps noble's pure-JS keccak_256 for hash-wasm's WASM keccak once the optional
// dependency finishes loading — the ambient counterpart of the `_wasm` secp256k1 scenario above.
// The dispatch is global, so the base scenarios accelerate too once the module is ready; these
// twins exist to pin the fully-loaded number explicitly, with the load settled in `setup` rather
// than mid-warmup. Byte-identity with noble is pinned by `tests/signing/keccak.test.ts`, not
// here. The scenarios register only when the optional dependency is installed, so a checkout
// without it skips them cleanly. (The import declaration is hoisted; keeping it next to the
// scenarios keeps this file append-only.)

import { preloadWasmKeccak } from "../../../src/signing/_keccak.ts";

const hashWasmAvailable = await import("hash-wasm").then(
  () => true,
  () => false,
);

if (hashWasmAvailable) {
  for (const count of [1, 100] as const) {
    scenario({
      name: `signing/l1_action_hash_order_${count}_wasm`,
      group: "signing",
      description: `createL1ActionHash() over an order action with ${count} order(s) with the WASM keccak provider (hash-wasm); opt-in counterpart of l1_action_hash_order_${count}`,
      unit: "order",
      unitsPerIteration: count,
      iterations: count === 1 ? 2000 : 100,
      setup: async () => {
        await preloadWasmKeccak();
        return { action: orderAction(count) };
      },
      run: ({ action }: { action: Record<string, unknown> }) => {
        createL1ActionHash({ action, nonce: NONCE });
      },
    });
  }

  scenario({
    name: "signing/eip712_agent_digest_wasm",
    group: "signing",
    description:
      "createL1AgentDigest() with the WASM keccak provider (hash-wasm); opt-in counterpart of eip712_agent_digest",
    unit: "digest",
    iterations: 5000,
    setup: () => preloadWasmKeccak(),
    run: () => {
      createL1AgentDigest(AGENT_ACTION_HASH, true);
    },
  });

  scenario({
    name: "signing/eip712_multisig_digest_wasm",
    group: "signing",
    description:
      "createMultiSigDigest() with the WASM keccak provider (hash-wasm); opt-in counterpart of eip712_multisig_digest",
    unit: "digest",
    iterations: 5000,
    setup: () => preloadWasmKeccak(),
    run: () => {
      createMultiSigDigest(MULTI_SIG_ACTION_HASH, NONCE, "0x66eee", true);
    },
  });
}

// --- EIP-712 user-signed digest -------------------------------------------------
// User-signed actions (approveAgent, usdSend, …) share the fixed `HyperliquidSignTransaction`
// domain with the multi-sig outer but vary in shape, so their digests are hand-rolled from a
// plan compiled once per `types` object (`createUserSignedDigestBytes`, domain separator shared
// with the multi-sig cache) instead of viem's generic `hashTypedData`. The pair is measured side
// by side so the saving stays visible in the report; byte-equality is pinned by
// `tests/signing/userSignedDigest.test.ts`, not here. (The import declaration is hoisted; keeping
// it next to the scenarios keeps this file append-only.)

import { createUserSignedDigestBytes } from "../../../src/signing/_fastDigest.ts";

/** An approveAgent action exactly as `executeUserSignedAction` signs it (testnet). */
const APPROVE_AGENT_ACTION = {
  type: "approveAgent",
  signatureChainId: "0x66eee",
  hyperliquidChain: "Testnet",
  agentAddress: "0x0000000000000000000000000000000000000001",
  agentName: "Agent",
  nonce: NONCE,
} as const;

/** The typed-data envelope viem's `hashTypedData` is benchmarked on (same action). */
const APPROVE_AGENT_TYPED_DATA = {
  domain: {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: 0x66eee,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  },
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    "HyperliquidTransaction:ApproveAgent": [
      { name: "hyperliquidChain", type: "string" },
      { name: "agentAddress", type: "address" },
      { name: "agentName", type: "string" },
      { name: "nonce", type: "uint64" },
    ],
  },
  primaryType: "HyperliquidTransaction:ApproveAgent",
  message: {
    hyperliquidChain: "Testnet",
    agentAddress: "0x0000000000000000000000000000000000000001",
    agentName: "Agent",
    nonce: NONCE,
  },
} as const;

scenario({
  name: "signing/eip712_user_signed_digest",
  group: "signing",
  description: "createUserSignedDigestBytes(): hand-rolled EIP-712 digest of an approveAgent action",
  unit: "digest",
  iterations: 5000,
  run: () => {
    createUserSignedDigestBytes(APPROVE_AGENT_ACTION, ApproveAgentTypes, "0x66eee");
  },
});

scenario({
  name: "signing/eip712_user_signed_digest_viem",
  group: "signing",
  description: "viem hashTypedData() over the same approveAgent action (the oracle the fast digest replaces)",
  unit: "digest",
  iterations: 2000,
  run: () => {
    hashTypedData(APPROVE_AGENT_TYPED_DATA as never);
  },
});

// --- End-to-end user-signed action without ECDSA --------------------------------
// Counterpart of `signing/order_e2e_no_ecdsa` for the user-signed path: the stub wallet's
// raw-digest `sign` takes the fast digest path, so validation, nonce issuance, the hand-rolled
// digest, and dispatch are what remains on the clock. Grounds the user-signed digest work end to
// end through `executeUserSignedAction`; the per-digest view is the pair above.

scenario({
  name: "signing/approve_agent_e2e_no_ecdsa",
  group: "signing",
  description:
    "ExchangeClient.approveAgent() with a stub wallet (fixed signature): SDK shell overhead without secp256k1",
  unit: "request",
  iterations: 200,
  samples: 15,
  setup: () => {
    const transport = new MockExchangeTransport(0);
    const client = new ExchangeClient({
      transport,
      wallet: digestStubWallet("0x1111111111111111111111111111111111111111"),
    });
    return { client };
  },
  run: async ({ client }: { client: ExchangeClient }) => {
    await client.approveAgent({
      agentAddress: "0x0000000000000000000000000000000000000001",
      agentName: "Agent",
    });
  },
});
