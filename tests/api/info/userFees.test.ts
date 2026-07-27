import { userFees, type UserFeesParameters, UserFeesRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
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
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "userFees",
  method: userFees,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
