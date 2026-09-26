import { portfolio, type PortfolioParameters, PortfolioRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/portfolio.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "PortfolioResponse");
const paramsSchema = valibotToJsonSchema(v.omit(PortfolioRequest, ["type"]));

runTest({
  name: "portfolio",
  codeTestFn: async (_t, client) => {
    const params: PortfolioParameters[] = [{ user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9" }];

    const data = await Promise.all(params.map((p) => client.portfolio(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "portfolio",
  method: portfolio,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
