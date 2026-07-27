import { userFunding, type UserFundingParameters, UserFundingRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/userFunding.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserFundingResponse");
const paramsSchema = valibotToJsonSchema(v.omit(UserFundingRequest, ["type"]));

runTest({
  name: "userFunding",
  codeTestFn: async (_t, client) => {
    const now = Date.now();
    const year = 1000 * 60 * 60 * 24 * 365;
    const params: UserFundingParameters[] = [
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05" },
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05", startTime: now - year },
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05", startTime: null },
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05", startTime: now - year, endTime: now },
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05", startTime: now - year, endTime: null },
    ];

    const data = await Promise.all(params.map((p) => client.userFunding(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "userFunding",
  method: userFunding,
  signature: "params",
  cases: [
    { params: { user: "0x0000000000000000000000000000000000000001" } },
    { params: { user: "0x0000000000000000000000000000000000000001", startTime: 1000, endTime: 2000 } },
  ],
  invalidParams: [{ user: "0x123" }, { user: "0x0000000000000000000000000000000000000001", startTime: -1 }],
});
