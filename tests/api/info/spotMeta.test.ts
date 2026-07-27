import { spotMeta } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/spotMeta.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "SpotMetaResponse");

runTest({
  name: "spotMeta",
  codeTestFn: async (_t, client) => {
    const data = await Promise.all([client.spotMeta()]);

    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "spotMeta",
  method: spotMeta,
  signature: "none",
});
