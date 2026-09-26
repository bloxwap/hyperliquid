import { extraAgents, type ExtraAgentsParameters, ExtraAgentsRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/extraAgents.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "ExtraAgentsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(ExtraAgentsRequest, ["type"]));

runTest({
  name: "extraAgents",
  codeTestFn: async (_t, client) => {
    const params: ExtraAgentsParameters[] = [{ user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9" }];

    const data = await Promise.all(params.map((p) => client.extraAgents(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, [
      "#/items/properties/validUntil/null", // null is account-state-gated, observed on mainnet only
    ]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "extraAgents",
  method: extraAgents,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
