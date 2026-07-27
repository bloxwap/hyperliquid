/**
 * Offline tests for every `ExchangeClient` method path: valid params produce the exact wire
 * payload (action fields, envelope nonce, signature) through a recording mock transport, and
 * invalid params fail validation client-side with zero requests sent. Also covers the
 * multi-sig wrapper paths, `skipValidation`, transport error passthrough, nonce-manager
 * plumbing, function-valued `defaultExpiresAfter`, and the `prepareRequest`/`submitPrepared`
 * client wrappers.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@jsr/std__assert";
import {
  ApiRequestError,
  ExchangeClient,
  type ExchangeSingleWalletConfig,
  HyperliquidError,
  ValidationError,
} from "@bloxwap/hyperliquid";
import { order, type OrderParameters } from "@bloxwap/hyperliquid/api/exchange";
import { executeUserSignedAction } from "../../../src/api/exchange/_methods/_base/execute.ts";
import {
  CLOID,
  failingTransport,
  FIXED_NONCE,
  LIMIT_ORDER,
  MULTI_SIG_USER,
  multiSigConfig,
  recordingTransport,
  SIGNATURE_CHAIN_ID,
  singleWalletConfig,
  wallet,
} from "./_mockTransport.ts";

type Client = ExchangeClient<ExchangeSingleWalletConfig>;

const ADDR1 = "0x0000000000000000000000000000000000000001";
const VAULT = "0x457ab3acf4a4e01156ce269545a9d3d05fff2f0b";
const SUB_ACCOUNT = "0xcb3f0bd249a89e45e86a44bcfc7113e4ffe84cd1";
const USDC = "USDC:0xeb62eee3685fc4c43992febcd9e75443";

/** System fields every user-signed (EIP-712) action carries on the wire. */
const US = { signatureChainId: SIGNATURE_CHAIN_ID, hyperliquidChain: "Testnet" } as const;

/** Asserts the shape of an ECDSA signature as it goes over the wire. */
function assertSignature(signature: { r: string; s: string; v: number }): void {
  assertEquals(typeof signature.r, "string");
  assertEquals(typeof signature.s, "string");
  assert(signature.r.startsWith("0x") && signature.r.length === 66);
  assert(signature.s.startsWith("0x") && signature.s.length === 66);
  assert(signature.v === 27 || signature.v === 28);
}

/**
 * One client-method path: `run` must post exactly one exchange request whose action deep-equals
 * `action` and whose envelope nonce is `nonce` (default {@linkcode FIXED_NONCE}); `invalid` must
 * fail with a `ValidationError` before any request is sent.
 */
interface MethodCase {
  run: (client: Client) => Promise<unknown>;
  action: Record<string, unknown>;
  nonce?: number;
  invalid?: (client: Client) => unknown;
}

// ============================================================
// Method paths (valid params → exact wire payload)
// ============================================================

const METHOD_CASES: Record<string, MethodCase> = {
  agentEnableDexAbstraction: {
    run: (c) => c.agentEnableDexAbstraction(),
    action: { type: "agentEnableDexAbstraction" },
    invalid: (c) => c.agentEnableDexAbstraction({ expiresAfter: -1 }),
  },
  agentSendAsset: {
    run: (c) =>
      c.agentSendAsset({
        destination: ADDR1,
        sourceDex: "",
        destinationDex: "test",
        token: USDC,
        amount: "0.01",
      }),
    // The action carries its own nonce field, patched to match the envelope nonce.
    action: {
      type: "agentSendAsset",
      destination: ADDR1,
      sourceDex: "",
      destinationDex: "test",
      token: USDC,
      amount: "0.01",
      fromSubAccount: "",
      nonce: FIXED_NONCE,
    },
    invalid: (c) => c.agentSendAsset({} as never),
  },
  agentSetAbstraction: {
    run: (c) => c.agentSetAbstraction({ abstraction: "u" }),
    action: { type: "agentSetAbstraction", abstraction: "u" },
    invalid: (c) => c.agentSetAbstraction({} as never),
  },
  approveAgent: {
    run: (c) => c.approveAgent({ agentAddress: ADDR1, agentName: "agentName" }),
    action: { type: "approveAgent", ...US, agentAddress: ADDR1, agentName: "agentName", nonce: FIXED_NONCE },
    // A >16-char base name fails the length check (exercises the check's message function).
    invalid: (c) => c.approveAgent({ agentAddress: ADDR1, agentName: "a".repeat(17) }),
  },
  approveBuilderFee: {
    run: (c) => c.approveBuilderFee({ maxFeeRate: "0.001%", builder: ADDR1 }),
    action: { type: "approveBuilderFee", ...US, maxFeeRate: "0.001%", builder: ADDR1, nonce: FIXED_NONCE },
    invalid: (c) => c.approveBuilderFee({} as never),
  },
  authorizeAqav2Role: {
    run: (c) => c.authorizeAqav2Role({ token: 0, role: "technical" }),
    action: { type: "authorizeAqav2Role", token: 0, role: "technical" },
    invalid: (c) => c.authorizeAqav2Role({} as never),
  },
  batchModify: {
    run: (c) => c.batchModify({ modifies: [{ oid: 123, order: LIMIT_ORDER }] }),
    action: { type: "batchModify", modifies: [{ oid: 123, order: LIMIT_ORDER }] },
    invalid: (c) => c.batchModify({} as never),
  },
  borrowLend: {
    run: (c) => c.borrowLend({ operation: "supply", token: 0, amount: "30" }),
    action: { type: "borrowLend", operation: "supply", token: 0, amount: "30" },
    invalid: (c) => c.borrowLend({} as never),
  },
  cancel: {
    run: (c) => c.cancel({ cancels: [{ a: 0, o: 123 }] }),
    action: { type: "cancel", cancels: [{ a: 0, o: 123 }] },
    invalid: (c) => c.cancel({ cancels: [] }),
  },
  cancelByCloid: {
    run: (c) => c.cancelByCloid({ cancels: [{ asset: 0, cloid: CLOID }] }),
    action: { type: "cancelByCloid", cancels: [{ asset: 0, cloid: CLOID }] },
    invalid: (c) => c.cancelByCloid({} as never),
  },
  cDeposit: {
    run: (c) => c.cDeposit({ wei: 1 }),
    action: { type: "cDeposit", ...US, wei: 1, nonce: FIXED_NONCE },
    invalid: (c) => c.cDeposit({} as never),
  },
  claimRewards: {
    run: (c) => c.claimRewards(),
    action: { type: "claimRewards" },
    invalid: (c) => c.claimRewards({ expiresAfter: -1 }),
  },
  createSubAccount: {
    run: (c) => c.createSubAccount({ name: "sub" }),
    action: { type: "createSubAccount", name: "sub" },
    invalid: (c) => c.createSubAccount({} as never),
  },
  createVault: {
    run: (c) => c.createVault({ name: "test", description: "1234567890", initialUsd: 100 * 1e6 }),
    // Like agentSendAsset, the action carries a nonce field patched to the envelope nonce.
    action: {
      type: "createVault",
      name: "test",
      description: "1234567890",
      initialUsd: 100_000_000,
      nonce: FIXED_NONCE,
    },
    invalid: (c) => c.createVault({} as never),
  },
  cSignerAction: {
    run: (c) => c.cSignerAction({ jailSelf: null }),
    action: { type: "CSignerAction", jailSelf: null },
    invalid: (c) => c.cSignerAction({} as never),
  },
  cValidatorAction: {
    run: (c) =>
      c.cValidatorAction({
        changeProfile: {
          node_ip: { Ip: "1.2.3.4" },
          name: "...",
          description: "...",
          unjailed: false,
          disable_delegations: false,
          commission_bps: null,
          signer: null,
        },
      }),
    action: {
      type: "CValidatorAction",
      changeProfile: {
        node_ip: { Ip: "1.2.3.4" },
        name: "...",
        description: "...",
        unjailed: false,
        disable_delegations: false,
        commission_bps: null,
        signer: null,
      },
    },
    invalid: (c) => c.cValidatorAction({} as never),
  },
  cWithdraw: {
    run: (c) => c.cWithdraw({ wei: 1 }),
    action: { type: "cWithdraw", ...US, wei: 1, nonce: FIXED_NONCE },
    invalid: (c) => c.cWithdraw({} as never),
  },
  evmUserModify: {
    run: (c) => c.evmUserModify({ usingBigBlocks: true }),
    action: { type: "evmUserModify", usingBigBlocks: true },
    invalid: (c) => c.evmUserModify({} as never),
  },
  finalizeEvmContract: {
    run: (c) => c.finalizeEvmContract({ token: 0, input: { create: { nonce: 0 } } }),
    action: { type: "finalizeEvmContract", token: 0, input: { create: { nonce: 0 } } },
    invalid: (c) => c.finalizeEvmContract({} as never),
  },
  gossipPriorityBid: {
    run: (c) => c.gossipPriorityBid({ slotId: 0, ip: "1.2.3.4", maxGas: 100_000_000 }),
    action: { type: "gossipPriorityBid", slotId: 0, ip: "1.2.3.4", maxGas: 100_000_000 },
    invalid: (c) => c.gossipPriorityBid({} as never),
  },
  hip3LiquidatorTransfer: {
    run: (c) => c.hip3LiquidatorTransfer({ dex: "test", ntl: 1_000_000, isDeposit: true }),
    action: { type: "hip3LiquidatorTransfer", dex: "test", ntl: 1_000_000, isDeposit: true },
    invalid: (c) => c.hip3LiquidatorTransfer({} as never),
  },
  linkStakingUser: {
    run: (c) => c.linkStakingUser({ user: ADDR1, isFinalize: false }),
    action: { type: "linkStakingUser", ...US, user: ADDR1, isFinalize: false, nonce: FIXED_NONCE },
    invalid: (c) => c.linkStakingUser({} as never),
  },
  modify: {
    run: (c) => c.modify({ oid: 123, order: LIMIT_ORDER }),
    action: { type: "modify", oid: 123, order: LIMIT_ORDER },
    invalid: (c) => c.modify({} as never),
  },
  noop: {
    run: (c) => c.noop({ nonce: 12345 }),
    action: { type: "noop" },
    // The params nonce takes precedence over the configured nonceManager.
    nonce: 12345,
  },
  order: {
    run: (c) => c.order({ orders: [LIMIT_ORDER], grouping: "na" }),
    action: { type: "order", orders: [LIMIT_ORDER], grouping: "na" },
    invalid: (c) => c.order({ orders: [] }),
  },
  perpDeploy: {
    run: (c) =>
      c.perpDeploy({
        registerAsset2: {
          maxGas: 1000000000000,
          assetRequest: { coin: "1", szDecimals: 1, oraclePx: "1", marginTableId: 1, marginMode: "noCross" },
          dex: "test",
          schema: null,
        },
      }),
    action: {
      type: "perpDeploy",
      registerAsset2: {
        maxGas: 1000000000000,
        assetRequest: { coin: "1", szDecimals: 1, oraclePx: "1", marginTableId: 1, marginMode: "noCross" },
        dex: "test",
        schema: null,
      },
    },
    invalid: (c) => c.perpDeploy({} as never),
  },
  registerReferrer: {
    run: (c) => c.registerReferrer({ code: "TEST" }),
    action: { type: "registerReferrer", code: "TEST" },
    invalid: (c) => c.registerReferrer({} as never),
  },
  reserveRequestWeight: {
    run: (c) => c.reserveRequestWeight({ weight: 1 }),
    action: { type: "reserveRequestWeight", weight: 1 },
    invalid: (c) => c.reserveRequestWeight({} as never),
  },
  sendAsset: {
    run: (c) => c.sendAsset({ destination: ADDR1, sourceDex: "", destinationDex: "test", token: USDC, amount: "0.01" }),
    action: {
      type: "sendAsset",
      ...US,
      destination: ADDR1,
      sourceDex: "",
      destinationDex: "test",
      token: USDC,
      amount: "0.01",
      fromSubAccount: "",
      nonce: FIXED_NONCE,
    },
    invalid: (c) => c.sendAsset({} as never),
  },
  sendToEvmWithData: {
    run: (c) =>
      c.sendToEvmWithData({
        token: "USDC",
        amount: "1",
        sourceDex: "spot",
        destinationRecipient: ADDR1,
        addressEncoding: "hex",
        destinationChainId: 998,
        gasLimit: 200000,
        data: "0x",
      }),
    action: {
      type: "sendToEvmWithData",
      ...US,
      token: "USDC",
      amount: "1",
      sourceDex: "spot",
      destinationRecipient: ADDR1,
      addressEncoding: "hex",
      destinationChainId: 998,
      gasLimit: 200000,
      data: "0x",
      nonce: FIXED_NONCE,
    },
    invalid: (c) => c.sendToEvmWithData({} as never),
  },
  setDisplayName: {
    run: (c) => c.setDisplayName({ displayName: "name" }),
    action: { type: "setDisplayName", displayName: "name" },
    invalid: (c) => c.setDisplayName({} as never),
  },
  setReferrer: {
    run: (c) => c.setReferrer({ code: "TEST" }),
    action: { type: "setReferrer", code: "TEST" },
    invalid: (c) => c.setReferrer({} as never),
  },
  spotDeploy: {
    run: (c) =>
      c.spotDeploy({
        registerToken2: {
          spec: { name: "TestToken", szDecimals: 8, weiDecimals: 8 },
          maxGas: 1000000,
          fullName: "TestToken (TT)",
        },
      }),
    action: {
      type: "spotDeploy",
      registerToken2: {
        spec: { name: "TestToken", szDecimals: 8, weiDecimals: 8 },
        maxGas: 1000000,
        fullName: "TestToken (TT)",
      },
    },
    invalid: (c) => c.spotDeploy({} as never),
  },
  spotSend: {
    run: (c) => c.spotSend({ destination: ADDR1, token: USDC, amount: "1" }),
    action: { type: "spotSend", ...US, destination: ADDR1, token: USDC, amount: "1", time: FIXED_NONCE },
    invalid: (c) => c.spotSend({} as never),
  },
  spotUser: {
    run: (c) => c.spotUser({ toggleSpotDusting: { optOut: true } }),
    action: { type: "spotUser", toggleSpotDusting: { optOut: true } },
    invalid: (c) => c.spotUser({} as never),
  },
  stakingLinkDisableTradingUser: {
    run: (c) => c.stakingLinkDisableTradingUser({ tradingUser: ADDR1 }),
    action: { type: "stakingLinkDisableTradingUser", ...US, tradingUser: ADDR1, nonce: FIXED_NONCE },
    invalid: (c) => c.stakingLinkDisableTradingUser({} as never),
  },
  subAccountModify: {
    run: (c) => c.subAccountModify({ subAccountUser: SUB_ACCOUNT, name: "sub" }),
    action: { type: "subAccountModify", subAccountUser: SUB_ACCOUNT, name: "sub" },
    invalid: (c) => c.subAccountModify({} as never),
  },
  subAccountSpotTransfer: {
    run: (c) => c.subAccountSpotTransfer({ subAccountUser: SUB_ACCOUNT, isDeposit: true, token: USDC, amount: "1" }),
    action: { type: "subAccountSpotTransfer", subAccountUser: SUB_ACCOUNT, isDeposit: true, token: USDC, amount: "1" },
    invalid: (c) => c.subAccountSpotTransfer({} as never),
  },
  subAccountTransfer: {
    run: (c) => c.subAccountTransfer({ subAccountUser: SUB_ACCOUNT, isDeposit: true, usd: 1 }),
    action: { type: "subAccountTransfer", subAccountUser: SUB_ACCOUNT, isDeposit: true, usd: 1 },
    invalid: (c) => c.subAccountTransfer({} as never),
  },
  tokenDelegate: {
    run: (c) => c.tokenDelegate({ validator: ADDR1, wei: 1, isUndelegate: false }),
    action: { type: "tokenDelegate", ...US, validator: ADDR1, wei: 1, isUndelegate: false, nonce: FIXED_NONCE },
    invalid: (c) => c.tokenDelegate({} as never),
  },
  topUpIsolatedOnlyMargin: {
    run: (c) => c.topUpIsolatedOnlyMargin({ asset: 0, leverage: "0.5" }),
    action: { type: "topUpIsolatedOnlyMargin", asset: 0, leverage: "0.5" },
    invalid: (c) => c.topUpIsolatedOnlyMargin({} as never),
  },
  twapCancel: {
    run: (c) => c.twapCancel({ a: 0, t: 1 }),
    action: { type: "twapCancel", a: 0, t: 1 },
    invalid: (c) => c.twapCancel({} as never),
  },
  twapOrder: {
    run: (c) => c.twapOrder({ twap: { a: 0, b: true, s: "0.1", r: false, m: 5, t: false } }),
    action: { type: "twapOrder", twap: { a: 0, b: true, s: "0.1", r: false, m: 5, t: false } },
    invalid: (c) => c.twapOrder({} as never),
  },
  updateIsolatedMargin: {
    run: (c) => c.updateIsolatedMargin({ asset: 0, isBuy: true, ntli: 1_000_000 }),
    action: { type: "updateIsolatedMargin", asset: 0, isBuy: true, ntli: 1_000_000 },
    invalid: (c) => c.updateIsolatedMargin({} as never),
  },
  updateLeverage: {
    run: (c) => c.updateLeverage({ asset: 0, isCross: true, leverage: 1 }),
    action: { type: "updateLeverage", asset: 0, isCross: true, leverage: 1 },
    invalid: (c) => c.updateLeverage({} as never),
  },
  usdClassTransfer: {
    run: (c) => c.usdClassTransfer({ amount: "1", toPerp: true }),
    action: { type: "usdClassTransfer", ...US, amount: "1", toPerp: true, nonce: FIXED_NONCE },
    invalid: (c) => c.usdClassTransfer({} as never),
  },
  usdSend: {
    run: (c) => c.usdSend({ destination: ADDR1, amount: "1" }),
    action: { type: "usdSend", ...US, destination: ADDR1, amount: "1", time: FIXED_NONCE },
    invalid: (c) => c.usdSend({} as never),
  },
  userDexAbstraction: {
    run: (c) => c.userDexAbstraction({ user: ADDR1, enabled: true }),
    action: { type: "userDexAbstraction", ...US, user: ADDR1, enabled: true, nonce: FIXED_NONCE },
    invalid: (c) => c.userDexAbstraction({} as never),
  },
  userOutcome: {
    run: (c) => c.userOutcome({ splitOutcome: { outcome: 0, amount: "1" } }),
    action: { type: "userOutcome", splitOutcome: { outcome: 0, amount: "1" } },
    invalid: (c) => c.userOutcome({} as never),
  },
  userPortfolioMargin: {
    run: (c) => c.userPortfolioMargin({ user: ADDR1, enabled: true }),
    action: { type: "userPortfolioMargin", ...US, user: ADDR1, enabled: true, nonce: FIXED_NONCE },
    invalid: (c) => c.userPortfolioMargin({} as never),
  },
  userSetAbstraction: {
    run: (c) => c.userSetAbstraction({ user: wallet.address, abstraction: "unifiedAccount" }),
    action: {
      type: "userSetAbstraction",
      ...US,
      // Addresses are lowercased by validation (the viem address above is EIP-55 checksummed).
      user: wallet.address.toLowerCase(),
      abstraction: "unifiedAccount",
      nonce: FIXED_NONCE,
    },
    invalid: (c) => c.userSetAbstraction({} as never),
  },
  validatorL1Stream: {
    run: (c) => c.validatorL1Stream({ riskFreeRate: "0.05" }),
    action: { type: "validatorL1Stream", riskFreeRate: "0.05" },
    invalid: (c) => c.validatorL1Stream({} as never),
  },
  vaultDistribute: {
    run: (c) => c.vaultDistribute({ vaultAddress: VAULT, usd: 1_000_000 }),
    action: { type: "vaultDistribute", vaultAddress: VAULT, usd: 1_000_000 },
    invalid: (c) => c.vaultDistribute({} as never),
  },
  vaultModify: {
    run: (c) => c.vaultModify({ vaultAddress: VAULT, allowDeposits: true, alwaysCloseOnWithdraw: true }),
    action: { type: "vaultModify", vaultAddress: VAULT, allowDeposits: true, alwaysCloseOnWithdraw: true },
    invalid: (c) => c.vaultModify({} as never),
  },
  vaultTransfer: {
    run: (c) => c.vaultTransfer({ vaultAddress: VAULT, isDeposit: true, usd: 5_000_000 }),
    action: { type: "vaultTransfer", vaultAddress: VAULT, isDeposit: true, usd: 5_000_000 },
    invalid: (c) => c.vaultTransfer({} as never),
  },
  withdraw3: {
    run: (c) => c.withdraw3({ amount: "2", destination: ADDR1 }),
    action: { type: "withdraw3", ...US, amount: "2", destination: ADDR1, time: FIXED_NONCE },
    invalid: (c) => c.withdraw3({} as never),
  },
};

describe("ExchangeClient method paths (offline)", () => {
  for (const [name, { run, action, nonce = FIXED_NONCE, invalid }] of Object.entries(METHOD_CASES)) {
    test(`${name}: valid params produce the exact wire payload`, async () => {
      const { calls, transport } = recordingTransport();
      const client = new ExchangeClient(singleWalletConfig(transport));

      const result = await run(client);

      assertEquals((result as { status: string }).status, "ok");
      assertEquals(calls.length, 1);
      assertEquals(calls[0].endpoint, "exchange");
      assertEquals(calls[0].payload.action, action);
      assertEquals(calls[0].payload.nonce, nonce);
      assertSignature(calls[0].payload.signature);
    });

    if (invalid) {
      test(`${name}: invalid params fail validation with zero requests sent`, async () => {
        const { calls, transport } = recordingTransport();
        const client = new ExchangeClient(singleWalletConfig(transport));

        // Sync (params-level) and async (options-level) validation failures both land here.
        await assertRejects(async () => await invalid(client), ValidationError);
        assertEquals(calls.length, 0);
      });
    }
  }

  test("convertToMultiSigUser: signers are serialized to a sorted JSON string", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.convertToMultiSigUser({ signers: { authorizedUsers: [ADDR1], threshold: 1 } });

    assertEquals(calls.length, 1);
    const action = calls[0].payload.action;
    assertEquals(action.type, "convertToMultiSigUser");
    assertEquals(action.signatureChainId, SIGNATURE_CHAIN_ID);
    assertEquals(action.hyperliquidChain, "Testnet");
    assertEquals(action.nonce, FIXED_NONCE);
    assertEquals(JSON.parse(action.signers as string), { authorizedUsers: [ADDR1], threshold: 1 });
    assertEquals(calls[0].payload.nonce, FIXED_NONCE);
    assertSignature(calls[0].payload.signature);
  });

  test("convertToMultiSigUser: missing signers fail validation with zero requests sent", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    // Params validation throws synchronously; the async wrapper turns it into a rejection.
    await assertRejects(async () => await client.convertToMultiSigUser({} as never), ValidationError);
    assertEquals(calls.length, 0);
  });

  test("scheduleCancel: params variant posts the scheduled time", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));
    const time = Date.now() + 30_000;

    await client.scheduleCancel({ time });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "scheduleCancel", time });
    assertEquals(calls[0].payload.nonce, FIXED_NONCE);
  });

  test("scheduleCancel: opts-only variant posts a time-less action", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.scheduleCancel();

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "scheduleCancel" });
  });

  test("scheduleCancel: a past time fails validation with zero requests sent", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    // The lead-time guard throws synchronously; the async wrapper turns it into a rejection.
    await assertRejects(async () => await client.scheduleCancel({ time: 1 }), ValidationError);
    assertEquals(calls.length, 0);
  });
});

// ============================================================
// Multi-sig wrapper paths
// ============================================================

describe("ExchangeClient multi-sig paths (offline)", () => {
  /** Asserts the multi-sig wrapper envelope around an inner action. */
  function assertMultiSigPayload(
    call: {
      payload: { action: Record<string, unknown>; nonce: number; signature: { r: string; s: string; v: number } };
    },
    innerAction: Record<string, unknown>,
  ): void {
    const { action, nonce, signature } = call.payload;
    assertEquals(nonce, FIXED_NONCE);
    assertSignature(signature);
    assertEquals(action.type, "multiSig");
    assertEquals(action.signatureChainId, SIGNATURE_CHAIN_ID);
    const signatures = action.signatures as { r: string; s: string; v: number }[];
    assertEquals(signatures.length, 2); // one trimmed inner signature per signer
    for (const inner of signatures) assertSignature(inner);
    const payload = action.payload as { multiSigUser: string; outerSigner: string; action: Record<string, unknown> };
    assertEquals(payload.multiSigUser, MULTI_SIG_USER);
    assertEquals(payload.outerSigner, wallet.address.toLowerCase());
    assertEquals(payload.action, innerAction);
  }

  test("L1 action: order is wrapped and signed by every signer", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(multiSigConfig(transport));

    await client.order({ orders: [LIMIT_ORDER], grouping: "na" });

    assertEquals(calls.length, 1);
    assertMultiSigPayload(calls[0], { type: "order", orders: [LIMIT_ORDER], grouping: "na" });
  });

  test("user-signed action: approveAgent is wrapped and signed by every signer", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(multiSigConfig(transport));

    await client.approveAgent({ agentAddress: ADDR1, agentName: "agentName" });

    assertEquals(calls.length, 1);
    assertMultiSigPayload(calls[0], {
      type: "approveAgent",
      ...US,
      agentAddress: ADDR1,
      agentName: "agentName",
      nonce: FIXED_NONCE,
    });
  });

  test("userSetAbstraction: the multi-sig payload action maps abstraction to its wire letter", async () => {
    const mappings = [
      ["disabled", "i"],
      ["unifiedAccount", "u"],
      ["portfolioMargin", "p"],
    ] as const;
    for (const [abstraction, letter] of mappings) {
      const { calls, transport } = recordingTransport();
      const client = new ExchangeClient(multiSigConfig(transport));

      await client.userSetAbstraction({ user: MULTI_SIG_USER, abstraction });

      assertEquals(calls.length, 1);
      const payload = calls[0].payload.action.payload as { action: Record<string, unknown> };
      assertEquals(payload.action.abstraction, letter);
      assertEquals(payload.action.user, MULTI_SIG_USER);
    }
  });

  test("userSetAbstraction: dexAbstraction passes through to the multi-sig payload unmapped", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(multiSigConfig(transport));

    // dexAbstraction has no single-letter wire form — the full name goes through unchanged.
    await client.userSetAbstraction({ user: MULTI_SIG_USER, abstraction: "dexAbstraction" });

    assertEquals(calls.length, 1);
    const payload = calls[0].payload.action.payload as { action: Record<string, unknown> };
    assertEquals(payload.action.abstraction, "dexAbstraction");
    assertEquals(payload.action.user, MULTI_SIG_USER);
  });

  test("userSetAbstraction: an unmapped abstraction passes through on the skipValidation path", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(multiSigConfig(transport));

    // Only reachable with validation skipped: the schema restricts abstraction to the three
    // letter-mapped values plus dexAbstraction, so any other string exercises the
    // payload-mapping passthrough branch.
    await client.userSetAbstraction({ user: MULTI_SIG_USER, abstraction: "other" as never }, { skipValidation: true });

    assertEquals(calls.length, 1);
    const payload = calls[0].payload.action.payload as { action: Record<string, unknown> };
    assertEquals(payload.action.abstraction, "other");
  });

  test("multi-sig without signatureChainId falls back to the leader wallet's chain ID", async () => {
    const { calls, transport } = recordingTransport();
    const config = multiSigConfig(transport);
    delete config.signatureChainId;
    const client = new ExchangeClient(config);

    await client.order({ orders: [LIMIT_ORDER], grouping: "na" });

    assertEquals(calls.length, 1);
    // A viem local account has no chain; the adapter reports "0x1".
    assertEquals(calls[0].payload.action.signatureChainId, "0x1");
  });
});

// ============================================================
// Options plumbing (vault, expiresAfter, signal, nonceManager)
// ============================================================

describe("ExchangeClient options plumbing (offline)", () => {
  test("vaultAddress and expiresAfter options land in the request envelope", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.order({ orders: [LIMIT_ORDER], grouping: "na" }, { vaultAddress: VAULT, expiresAfter: 1700000060000 });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.vaultAddress, VAULT);
    assertEquals(calls[0].payload.expiresAfter, 1700000060000);
  });

  test("defaultVaultAddress config applies when the option is absent; the option wins when both are set", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport, { defaultVaultAddress: VAULT }));

    await client.order({ orders: [LIMIT_ORDER], grouping: "na" });
    await client.order({ orders: [LIMIT_ORDER], grouping: "na" }, { vaultAddress: ADDR1 });

    assertEquals(calls[0].payload.vaultAddress, VAULT);
    assertEquals(calls[1].payload.vaultAddress, ADDR1);
  });

  test("function-valued defaultExpiresAfter resolves (sync and async) into the envelope", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport, { defaultExpiresAfter: () => 1700000060000 }));
    const asyncClient = new ExchangeClient(
      singleWalletConfig(transport, { defaultExpiresAfter: async () => 1700000060001 }),
    );

    await client.order({ orders: [LIMIT_ORDER], grouping: "na" });
    await asyncClient.order({ orders: [LIMIT_ORDER], grouping: "na" });

    assertEquals(calls[0].payload.expiresAfter, 1700000060000);
    assertEquals(calls[1].payload.expiresAfter, 1700000060001);
  });

  test("a synchronously throwing defaultExpiresAfter rejects instead of throwing", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(
      singleWalletConfig(transport, {
        defaultExpiresAfter: (): number => {
          throw new HyperliquidError("expiresAfter boom");
        },
      }),
    );

    await assertRejects(() => client.order({ orders: [LIMIT_ORDER], grouping: "na" }), HyperliquidError, "boom");
    assertEquals(calls.length, 0);
  });

  test("an invalid expiresAfter option rejects with a ValidationError and zero requests", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await assertRejects(
      () => client.order({ orders: [LIMIT_ORDER], grouping: "na" }, { expiresAfter: -1 }),
      ValidationError,
    );
    assertEquals(calls.length, 0);
  });

  test("the AbortSignal option is handed to the transport", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));
    const controller = new AbortController();

    await client.order({ orders: [LIMIT_ORDER], grouping: "na" }, { signal: controller.signal });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].signal, controller.signal);
  });

  test("the nonceManager receives the wallet address and its nonce is signed and posted", async () => {
    const { calls, transport } = recordingTransport();
    const seen: string[] = [];
    const client = new ExchangeClient(
      singleWalletConfig(transport, {
        nonceManager: (address) => {
          seen.push(address);
          return 1700000001234;
        },
      }),
    );

    await client.cancel({ cancels: [{ a: 0, o: 123 }] });

    assertEquals(seen, [wallet.address.toLowerCase()]);
    assertEquals(calls[0].payload.nonce, 1700000001234);
  });

  test("a promise-returning nonceManager is awaited", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport, { nonceManager: async () => 1700000009999 }));

    await client.cancel({ cancels: [{ a: 0, o: 123 }] });

    assertEquals(calls[0].payload.nonce, 1700000009999);
  });

  test("user-signed actions without signatureChainId fall back to the wallet's chain ID", async () => {
    const { calls, transport } = recordingTransport();
    const config = singleWalletConfig(transport);
    delete config.signatureChainId;
    const client = new ExchangeClient(config);

    await client.approveAgent({ agentAddress: ADDR1, agentName: "agentName" });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action.signatureChainId, "0x1");
  });
});

// ============================================================
// skipValidation
// ============================================================

describe("ExchangeClient skipValidation (offline)", () => {
  test("schema defaults are not filled and invalid values are posted as-is", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));
    // Type-valid but schema-invalid: negative asset id, non-decimal price, no grouping default.
    const rawOrder = { a: -1, b: true, p: "abc", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } };

    // The validated path rejects this client-side (synchronously; wrapped to a rejection)...
    await assertRejects(async () => await client.order({ orders: [rawOrder] } as never), ValidationError);
    assertEquals(calls.length, 0);

    // ...while the skipped path signs and posts it verbatim (rejection becomes the server's job).
    await client.order({ orders: [rawOrder] } as never, { skipValidation: true });
    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "order", orders: [rawOrder] });
  });

  test("user-signed actions skip validation too", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    // Schema-invalid but EIP-712-signable: an overlong agent name (string fields sign fine).
    await client.approveAgent({ agentAddress: ADDR1, agentName: "x".repeat(17) }, { skipValidation: true });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action.agentName, "x".repeat(17));
  });
});

// ============================================================
// Error passthrough
// ============================================================

describe("ExchangeClient error passthrough (offline)", () => {
  test("a transport rejection propagates to the caller unchanged", async () => {
    const boom = new Error("connection reset");
    const { calls, transport } = failingTransport(boom);
    const client = new ExchangeClient(singleWalletConfig(transport));

    const error = await assertRejects(() => client.order({ orders: [LIMIT_ORDER], grouping: "na" }), Error);
    assert(error === boom);
    assertEquals(calls.length, 1); // validation passed; the failure is the transport's
  });

  test("a single-status error envelope throws ApiRequestError with the server message", async () => {
    const response = { status: "ok", response: { type: "twapCancel", data: { status: { error: "Unknown twap" } } } };
    const { transport } = recordingTransport(response);
    const client = new ExchangeClient(singleWalletConfig(transport));

    const error = await assertRejects(() => client.twapCancel({ a: 0, t: 1 }), ApiRequestError, "Unknown twap");
    assertEquals(error.response, response);
  });

  test("a response that stops matching the error shape between checks throws with the fallback message", async () => {
    // Error detection is duck-typed and not idempotent: a getter that flips value between the
    // isErrorResponse check and the message extraction makes every shape check fail on the
    // second pass, so no server message can be extracted.
    let accesses = 0;
    const response = {
      get status() {
        return accesses++ === 0 ? "err" : "ok";
      },
      response: "flaky",
    };
    const { transport } = recordingTransport(response);
    const client = new ExchangeClient(singleWalletConfig(transport));

    const error = await assertRejects(
      () => client.order({ orders: [LIMIT_ORDER], grouping: "na" }),
      ApiRequestError,
      "An unknown error occurred",
    );
    assert(error.response === response);
  });
});

// ============================================================
// prepareRequest / submitPrepared (client wrappers)
// ============================================================

describe("ExchangeClient prepareRequest/submitPrepared (offline)", () => {
  const PARAMS: OrderParameters = { orders: [LIMIT_ORDER], grouping: "na" };

  test("prepare captures without posting; submit posts the payload as-is", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    const prepared = await client.prepareRequest((config) => order(config, PARAMS));
    assertEquals(calls.length, 0); // prepare itself posted nothing
    assertEquals(prepared.action, { type: "order", orders: [LIMIT_ORDER], grouping: "na" });
    assertEquals(prepared.nonce, FIXED_NONCE);
    assertSignature(prepared.signature);

    const submitted = await client.submitPrepared(prepared);
    assertEquals(calls.length, 1);
    assertEquals<unknown>(calls[0].payload, prepared); // posted byte-for-byte as prepared
    assertEquals((submitted as { status: string }).status, "ok");
  });

  test("submitPrepared forwards the AbortSignal option", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));
    const controller = new AbortController();

    const prepared = await client.prepareRequest((config) => order(config, PARAMS));
    await client.submitPrepared(prepared, { signal: controller.signal });

    assertEquals(calls[0].signal, controller.signal);
  });

  test("a callback issuing zero requests fails the prepare", async () => {
    const { transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await assertRejects(
      () => client.prepareRequest(() => Promise.resolve()),
      HyperliquidError,
      "did not issue a request",
    );
  });
});

// ============================================================
// execute internals
// ============================================================

describe("executeUserSignedAction internals (offline)", () => {
  test("EIP-712 types without a nonce/time field are rejected", async () => {
    const { transport } = recordingTransport();
    const config = singleWalletConfig(transport);

    await assertRejects(
      () =>
        executeUserSignedAction(
          config,
          { type: "custom" },
          {
            "HyperliquidTransaction:Custom": [{ name: "notNonce", type: "string" }],
          },
        ),
      HyperliquidError,
      'must contain a "nonce" or "time" field',
    );
  });
});
