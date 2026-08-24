import { userFees, type UserFeesParameters, UserFeesRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/userFees.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserFeesResponse");
const paramsSchema = valibotToJsonSchema(v.omit(UserFeesRequest, ["type"]));

runTest({
  name: "userFees",
  codeTestFn: async (_t, client) => {
    const params: UserFeesParameters[] = [
      { user: "0xe973105a27e17350500926ae664dfcfe6006d924" },
      { user: "0x768484f7e2ebb675c57838366c02ae99ba2a9b08" }, // userAddRate/userSpotAddRate negative
    ];

    const data = await Promise.all(params.map((p) => client.userFees(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, [
      "#/properties/trial/defined",
      "#/properties/nextTrialAvailableTimestamp/defined",
      "#/properties/stakingLink/defined",
    ]);
  },
});

// ============================================================
// Offline: response schema — stakingLink variants (issue #102)
// ============================================================

describe("userFees (offline)", () => {
  test("all stakingLink variants satisfy the response schema", () => {
    const base = {
      dailyUserVlm: [{ date: "2026-01-01", userCross: "0.0", userAdd: "0.0", exchange: "0.0" }],
      feeSchedule: {
        cross: "0.00045",
        add: "0.00015",
        spotCross: "0.0007",
        spotAdd: "0.0004",
        tiers: {
          vip: [{ ntlCutoff: "5000000.0", cross: "0.0004", add: "0.00012", spotCross: "0.0006", spotAdd: "0.0003" }],
          mm: [{ makerFractionCutoff: "0.005", add: "0.00001" }],
        },
        referralDiscount: "0.04",
        stakingDiscountTiers: [{ bpsOfMaxSupply: "0.0", discount: "0.0" }],
      },
      userCrossRate: "0.00045",
      userAddRate: "0.00015",
      userSpotCrossRate: "0.0007",
      userSpotAddRate: "0.0004",
      activeReferralDiscount: "0.04",
      trial: null,
      feeTrialEscrow: "0.0",
      nextTrialAvailableTimestamp: null,
      activeStakingDiscount: { bpsOfMaxSupply: "0.0", discount: "0.0" },
    };
    const samples = [
      { ...base, stakingLink: null },
      { ...base, trial: {}, nextTrialAvailableTimestamp: 1780000000000, stakingLink: null },
      {
        ...base,
        stakingLink: { type: "requested", stakingUser: "0x0000000000000000000000000000000000000001" },
      },
      {
        ...base,
        stakingLink: { type: "tradingUser", stakingUser: "0x0000000000000000000000000000000000000001" },
      },
      {
        ...base,
        stakingLink: { type: "stakingUser", tradingUser: "0x0000000000000000000000000000000000000002" },
      },
    ];
    schemaCoverage(responseSchema, samples);
  });
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "userFees",
  method: userFees,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
