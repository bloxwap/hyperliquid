import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type SpotDeployParameters, SpotDeployRequest, spotDeploy } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(
  v.union(SpotDeployRequest.entries.action.options.map((option) => v.omit(option, ["type"]))),
);

runTest({
  name: "spotDeploy",
  codeTestFn: async (_t, exchClient) => {
    const params: SpotDeployParameters[] = [
      {
        registerToken2: {
          spec: {
            name: "TestToken",
            szDecimals: 8,
            weiDecimals: 8,
          },
          maxGas: 1000000,
          fullName: "TestToken (TT)",
        },
      },
      {
        registerToken2: {
          spec: {
            name: "TestToken2",
            szDecimals: 8,
            weiDecimals: 8,
          },
          maxGas: 1000000,
        },
      },
      {
        userGenesis: {
          token: 0,
          userAndWei: [["0x0000000000000000000000000000000000000001", "1"]],
          existingTokenAndWei: [[0, "1"]],
          blacklistUsers: [["0x0000000000000000000000000000000000000001", true]],
        },
      },
      {
        userGenesis: {
          token: 0,
          userAndWei: [],
          existingTokenAndWei: [],
        },
      },
      {
        genesis: {
          token: 0,
          maxSupply: "10000000000",
          noHyperliquidity: true,
        },
      },
      {
        genesis: {
          token: 0,
          maxSupply: "10000000000",
        },
      },
      {
        registerSpot: {
          tokens: [0, 0],
        },
      },
      {
        registerHyperliquidity: {
          spot: 0,
          startPx: "1",
          orderSz: "1",
          nOrders: 1,
          nSeededLevels: 1,
        },
      },
      {
        registerHyperliquidity: {
          spot: 0,
          startPx: "1",
          orderSz: "1",
          nOrders: 1,
        },
      },
      {
        setDeployerTradingFeeShare: {
          token: 0,
          share: "0%",
        },
      },
      {
        enableQuoteToken: {
          token: 0,
        },
      },
      {
        disableQuoteToken: {
          token: 0,
        },
      },
      {
        enableAlignedQuoteToken: {
          token: 0,
        },
      },
      {
        disableAlignedQuoteToken: {
          token: 0,
        },
      },
      {
        requestEvmContract: {
          token: 0,
          address: "0x0000000000000000000000000000000000000001",
          evmExtraWeiDecimals: 0,
        },
      },
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(async () => {
          await exchClient.spotDeploy(p);
        }, ApiRequestError),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});

// ============================================================
// Offline: aligned quote token action variants
// ============================================================

describe("spotDeploy (offline)", () => {
  test("enableAlignedQuoteToken and disableAlignedQuoteToken are accepted and posted", async () => {
    const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const payloads: { action: Record<string, unknown> }[] = [];
    const transport: IRequestTransport = {
      isTestnet: true,
      request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        payloads.push(payload as { action: Record<string, unknown> });
        return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
      },
    };

    await spotDeploy({ transport, wallet }, { enableAlignedQuoteToken: { token: 1 } });
    await spotDeploy({ transport, wallet }, { disableAlignedQuoteToken: { token: 1 } });

    assertEquals(
      payloads.map((p) => p.action),
      [
        { type: "spotDeploy", enableAlignedQuoteToken: { token: 1 } },
        { type: "spotDeploy", disableAlignedQuoteToken: { token: 1 } },
      ],
    );
  });
});
