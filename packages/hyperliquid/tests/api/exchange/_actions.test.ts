import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { ExchangeClient } from "../../../src/api/exchange/client.ts";
import type { ExchangeConfig } from "../../../src/api/exchange/_methods/_base/_config.ts";
import type { IRequestTransport } from "../../../src/transport/_base.ts";
import { buildOrder, order, type OrderSuccessResponse } from "@bloxwap/hyperliquid/api/exchange/order";
import { buildUsdSend, usdSend } from "@bloxwap/hyperliquid/api/exchange/usdSend";
import { buildApproveAgent, approveAgent } from "@bloxwap/hyperliquid/api/exchange/approveAgent";
import { buildCreateVault, createVault } from "@bloxwap/hyperliquid/api/exchange/createVault";
import { buildAgentSendAsset, agentSendAsset } from "@bloxwap/hyperliquid/api/exchange/agentSendAsset";
import { buildUserSetAbstraction, userSetAbstraction } from "@bloxwap/hyperliquid/api/exchange/userSetAbstraction";
import { executeAction, signAction, submitAction, type CanonicalAction } from "@bloxwap/hyperliquid/actions/execution";

const wallet = privateKeyToAccount(`0x${"11".repeat(32)}`);
const secondWallet = privateKeyToAccount(`0x${"22".repeat(32)}`);
const address = "0x3333333333333333333333333333333333333333" as const;
const input = { orders: [{ a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } }] };

function harness(multi = false): { config: ExchangeConfig; calls: unknown[] } {
  const calls: unknown[] = [];
  const transport: IRequestTransport = {
    isTestnet: true,
    request: async <T>(_endpoint: "info" | "exchange", body: unknown): Promise<T> => {
      calls.push(body);
      return { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } } as T;
    },
  };
  const base = { transport, signatureChainId: "0x1" as const, nonceManager: () => 1_700_000_000_000 };
  return {
    config: multi ? { ...base, signers: [wallet, secondWallet], multiSigUser: address } : { ...base, wallet },
    calls,
  };
}

describe("canonical actions", () => {
  test("builders own and freeze nested input without freezing the caller's objects", () => {
    const params = structuredClone(input);
    const built = buildOrder(params);
    params.orders[0].p = "1";
    expect((built.payload.orders as typeof params.orders)[0].p).toBe("30000");
    expect(Object.isFrozen(params.orders)).toBe(false);
    expect(Object.isFrozen(built.payload.orders)).toBe(true);
    expect(() => {
      (built.payload.orders as typeof params.orders)[0].p = "1";
    }).toThrow();
    expect(() => buildOrder({ orders: [] })).toThrow();
  });

  test("sign consumes one nonce without posting; submit retains the inferred response", async () => {
    const { config, calls } = harness();
    let issued = 0;
    config.nonceManager = () => 1_700_000_000_000 + issued++;
    const client = new ExchangeClient(config);
    const action = buildOrder(input);
    expect(issued).toBe(0);
    const signed = await client.sign(action);
    expect(issued).toBe(1);
    expect(calls).toHaveLength(0);
    expect(Object.isFrozen(signed.action)).toBe(true);
    const response: OrderSuccessResponse = await client.submit(signed);
    expect(response.status).toBe("ok");
    expect(issued).toBe(1);
    await client.execute(action);
    expect(issued).toBe(2);
  });

  const cases: {
    name: string;
    direct: (config: ExchangeConfig) => Promise<unknown>;
    build: () => CanonicalAction<unknown>;
  }[] = [
    { name: "order", direct: (c) => order(c, input), build: () => buildOrder(input) },
    {
      name: "user-signed",
      direct: (c) => usdSend(c, { destination: address, amount: "1" }),
      build: () => buildUsdSend({ destination: address, amount: "1" }),
    },
    {
      name: "unnamed agent",
      direct: (c) => approveAgent(c, { agentAddress: address }),
      build: () => buildApproveAgent({ agentAddress: address }),
    },
    {
      name: "named agent",
      direct: (c) => approveAgent(c, { agentAddress: address, agentName: "bot" }),
      build: () => buildApproveAgent({ agentAddress: address, agentName: "bot" }),
    },
    {
      name: "vault nonce",
      direct: (c) =>
        createVault(c, { name: "my vault", description: "test vault description", initialUsd: 100_000_000 }),
      build: () =>
        buildCreateVault({ name: "my vault", description: "test vault description", initialUsd: 100_000_000 }),
    },
    {
      name: "agent nonce",
      direct: (c) =>
        agentSendAsset(c, { destination: address, sourceDex: "spot", destinationDex: "", token: "USDC", amount: "1" }),
      build: () =>
        buildAgentSendAsset({
          destination: address,
          sourceDex: "spot",
          destinationDex: "",
          token: "USDC",
          amount: "1",
        }),
    },
    {
      name: "multi-sig payload transformation",
      direct: (c) => userSetAbstraction(c, { user: address, abstraction: "unifiedAccount" }),
      build: () => buildUserSetAbstraction({ user: address, abstraction: "unifiedAccount" }),
    },
  ];
  for (const multi of [false, true])
    for (const example of cases) {
      test(`${example.name}: direct, staged, and reusable paths have identical signatures/wire bodies (${multi ? "multi" : "single"})`, async () => {
        const { config, calls } = harness(multi);
        await example.direct(config);
        const action = example.build();
        const signed = await signAction(config, action);
        expect(Object.isFrozen(signed)).toBe(true);
        expect(Object.isFrozen(signed.signature)).toBe(true);
        expect(Object.isFrozen(signed.action)).toBe(true);
        if (!multi && example.name === "order") expect(signed.action).toBe(action.payload);
        else expect(signed.action).not.toBe(action.payload);
        await submitAction(config, signed);
        await executeAction(config, action);
        const wire = calls.map((body) => JSON.stringify(body));
        expect(wire[1]).toBe(wire[0]);
        expect(wire[2]).toBe(wire[0]);
      });
    }

  test("unknown/reconstructed actions and cross-network signed submissions are rejected", async () => {
    const { config, calls } = harness();
    await expect(signAction(config, { payload: {} })).rejects.toThrow("SDK builder");
    const signed = await signAction(config, buildOrder(input));
    await expect(
      submitAction({ ...config, transport: { ...config.transport, isTestnet: false } }, signed),
    ).rejects.toThrow("network mismatch");
    await expect(submitAction(config, JSON.parse(JSON.stringify(signed)))).rejects.toThrow("ownership");
    expect(calls).toHaveLength(0);
  });
});
