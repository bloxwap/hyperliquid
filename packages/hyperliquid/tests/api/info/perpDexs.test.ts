import { perpDexs } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/perpDexs.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "PerpDexsResponse");

runTest({
  name: "perpDexs",
  codeTestFn: async (_t, client) => {
    const data = await Promise.all([client.perpDexs()]);

    schemaCoverage(responseSchema, data, [
      // Legacy fee fields and pre-clamp snapshots are covered offline.
      "#/items/anyOf/0/properties/deployerFeeScale/present",
      "#/items/anyOf/0/properties/lastDeployerFeeScaleChangeTime/present",
      "#/items/anyOf/0/properties/assetToFundingClamp/missing",
    ]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "perpDexs",
  method: perpDexs,
  signature: "none",
});
