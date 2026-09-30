import {
  metaAndAssetCtxs,
  type MetaAndAssetCtxsParameters,
  MetaAndAssetCtxsRequest,
} from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/metaAndAssetCtxs.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "MetaAndAssetCtxsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(MetaAndAssetCtxsRequest, ["type"]));

runTest({
  name: "metaAndAssetCtxs",
  codeTestFn: async (_t, client) => {
    const params: MetaAndAssetCtxsParameters[] = [{}, { dex: "gato" }, { dex: "meng" }];

    const data = await Promise.all(params.map((p) => client.metaAndAssetCtxs(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, [
      // Legacy timestamps and explicit normal mode are covered by offline snapshots.
      "#/items/0/properties/universe/items/properties/marginMode/enum/2",
      "#/items/0/properties/universe/items/properties/lastGrowthModeChangeTime/present",
    ]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "metaAndAssetCtxs",
  method: metaAndAssetCtxs,
  signature: "overloaded",
  cases: [{ params: { dex: "test" } }],
  invalidParams: [{ dex: 123 }],
});
