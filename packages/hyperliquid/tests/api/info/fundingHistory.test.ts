import { fundingHistory, type FundingHistoryParameters, FundingHistoryRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/fundingHistory.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "FundingHistoryResponse");
const paramsSchema = valibotToJsonSchema(v.omit(FundingHistoryRequest, ["type"]));

runTest({
  name: "fundingHistory",
  codeTestFn: async (_t, client) => {
    const now = Date.now();
    const year = 1000 * 60 * 60 * 24 * 365;
    const params: FundingHistoryParameters[] = [
      { coin: "ETH", startTime: now - year },
      { coin: "ETH", startTime: now - year, endTime: now },
      { coin: "ETH", startTime: now - year, endTime: null },
    ];

    const data = await Promise.all(params.map((p) => client.fundingHistory(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "fundingHistory",
  method: fundingHistory,
  signature: "params",
  cases: [{ params: { coin: "ETH", startTime: 1000 } }, { params: { coin: "ETH", startTime: 1000, endTime: 2000 } }],
  invalidParams: [
    { coin: 1, startTime: 1000 },
    { coin: "ETH", startTime: -1 },
  ],
});
