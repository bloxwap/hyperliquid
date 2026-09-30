import { meta, type MetaParameters, MetaRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/meta.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "MetaResponse");
const paramsSchema = valibotToJsonSchema(v.omit(MetaRequest, ["type"]));

runTest({
  name: "meta",
  codeTestFn: async (_t, client) => {
    const params: MetaParameters[] = [{}, { dex: "gato" }, { dex: "meng" }];

    const data = await Promise.all(params.map((p) => client.meta(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, [
      // Legacy timestamps and explicit normal mode are covered by offline snapshots.
      "#/properties/universe/items/properties/marginMode/enum/2",
      "#/properties/universe/items/properties/lastGrowthModeChangeTime/present",
    ]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "meta",
  method: meta,
  signature: "overloaded",
  cases: [{ params: { dex: "test" } }],
  invalidParams: [{ dex: 123 }],
});
