import { marginTable, type MarginTableParameters, MarginTableRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/marginTable.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "MarginTableResponse");
const paramsSchema = valibotToJsonSchema(v.omit(MarginTableRequest, ["type"]));

runTest({
  name: "marginTable",
  codeTestFn: async (_t, client) => {
    const params: MarginTableParameters[] = [
      { id: 1 },
      { id: 51, dex: "" }, // main dex
      { id: 51, dex: "flx" }, // other dex
    ];

    const data = await Promise.all(params.map((p) => client.marginTable(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "marginTable",
  method: marginTable,
  signature: "params",
  cases: [{ params: { id: 1 } }, { params: { id: 51, dex: "" } }, { params: { id: 51, dex: "flx" } }],
  invalidParams: [{ id: -1 }, { id: "abc" }, {}, { id: 1, dex: 5 }],
});
