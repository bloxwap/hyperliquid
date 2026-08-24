import { userFills, type UserFillsParameters, UserFillsRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/userFills.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserFillsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(UserFillsRequest, ["type"]));

runTest({
  name: "userFills",
  codeTestFn: async (_t, client) => {
    const params: UserFillsParameters[] = [
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9" },
      { user: "0x8172cc20bc3a55dcd07c75dd37ac0c2534de3b84", aggregateByTime: true },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", aggregateByTime: false },
    ];

    const data = await Promise.all(params.map((p) => client.userFills(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, [
      "#/items/properties/twapId/defined",
      // feeTrialEscrow is absent from these accounts' fills; liquidatedUser is only absent
      // when the liquidation has no liquidated user (e.g. backstop), unobserved live.
      "#/items/properties/feeTrialEscrow/present",
      "#/items/properties/liquidation/properties/liquidatedUser/missing",
    ]);
  },
});

// ============================================================
// Offline: response schema — feeTrialEscrow and liquidatedUser branches (issue #102)
// ============================================================

describe("userFills (offline)", () => {
  test("feeTrialEscrow and optional liquidatedUser satisfy the response schema", () => {
    const baseFill = {
      coin: "BTC",
      px: "100000.0",
      sz: "0.1",
      side: "B",
      time: 1780000000000,
      startPosition: "0.0",
      dir: "Open Long",
      closedPnl: "0.0",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      oid: 1,
      crossed: true,
      fee: "1.0",
      tid: 1,
      feeToken: "USDC",
      twapId: null,
    };
    const samples = [
      baseFill,
      {
        ...baseFill,
        side: "A",
        builderFee: "0.1",
        feeTrialEscrow: "0.5",
        cloid: "0x00000000000000000000000000000001",
        twapId: 7,
      },
      {
        ...baseFill,
        liquidation: {
          liquidatedUser: "0x0000000000000000000000000000000000000002",
          markPx: "99000.0",
          method: "market",
        },
      },
      {
        ...baseFill,
        // Backstop liquidation: no liquidated user on the wire (#102)
        liquidation: { markPx: "99000.0", method: "backstop" },
      },
    ];
    schemaCoverage(responseSchema, [samples]);
  });
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "userFills",
  method: userFills,
  signature: "params",
  cases: [
    { params: { user: "0x0000000000000000000000000000000000000001" } },
    { params: { user: "0x0000000000000000000000000000000000000001", aggregateByTime: true } },
  ],
  invalidParams: [{ user: "0x123" }, { user: "0x0000000000000000000000000000000000000001", aggregateByTime: "yes" }],
});
