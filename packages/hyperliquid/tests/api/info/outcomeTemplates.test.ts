import { outcomeTemplates } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/outcomeTemplates.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "OutcomeTemplatesResponse");

runTest({
  name: "outcomeTemplates",
  codeTestFn: async (_t, client) => {
    const data = await Promise.all([client.outcomeTemplates()]);

    schemaCoverage(responseSchema, data, ["#/items/properties/keywords/items/items/1/enum/1"]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "outcomeTemplates",
  method: outcomeTemplates,
  signature: "none",
});
