import { leadingVaults, type LeadingVaultsParameters, LeadingVaultsRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/leadingVaults.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "LeadingVaultsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(LeadingVaultsRequest, ["type"]));

runTest({
  name: "leadingVaults",
  codeTestFn: async (_t, client) => {
    const params: LeadingVaultsParameters[] = [{ user: "0xe019d6167E7e324aEd003d94098496b6d986aB05" }];

    const data = await Promise.all(params.map((p) => client.leadingVaults(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "leadingVaults",
  method: leadingVaults,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
