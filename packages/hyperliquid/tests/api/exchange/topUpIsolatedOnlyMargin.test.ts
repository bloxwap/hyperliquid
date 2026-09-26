import {
  type TopUpIsolatedOnlyMarginParameters,
  TopUpIsolatedOnlyMarginRequest,
} from "@bloxwap/hyperliquid/api/exchange";
import { ExchangeClient } from "@bloxwap/hyperliquid";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { recordingTransport, singleWalletConfig } from "./_mockTransport.ts";
import { openOrder, runTest, symbolConverter, topUpPerp } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/topUpIsolatedOnlyMargin.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "TopUpIsolatedOnlyMarginSuccessResponse");
const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(TopUpIsolatedOnlyMarginRequest.entries.action.entries), ["type"]),
);

runTest({
  name: "topUpIsolatedOnlyMargin",
  codeTestFn: async (_t, exchClient) => {
    // Use a strictIsolated asset
    const id = symbolConverter.getAssetId("ANIME")!;
    await topUpPerp(exchClient, "30");
    await openOrder(exchClient, "market", "ANIME");

    const params: TopUpIsolatedOnlyMarginParameters[] = [{ asset: id, leverage: "0.5" }];

    const data = await Promise.all(params.map((p) => exchClient.topUpIsolatedOnlyMargin(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: leverage accepts a number or a string, both normalized to the wire string
// ============================================================

describe("topUpIsolatedOnlyMargin (offline)", () => {
  test("a numeric leverage is normalized to its decimal string on the wire", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.topUpIsolatedOnlyMargin({ asset: 0, leverage: 0.5 });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "topUpIsolatedOnlyMargin", asset: 0, leverage: "0.5" });
  });

  test("a string leverage is posted unchanged", async () => {
    const { calls, transport } = recordingTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.topUpIsolatedOnlyMargin({ asset: 0, leverage: "0.5" });

    assertEquals(calls[0].payload.action.leverage, "0.5");
  });
});
