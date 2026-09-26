import { perpDexStatus, type PerpDexStatusParameters, PerpDexStatusRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/perpDexStatus.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "PerpDexStatusResponse");
const paramsSchema = valibotToJsonSchema(v.omit(PerpDexStatusRequest, ["type"]));

runTest({
  name: "perpDexStatus",
  codeTestFn: async (_t, client) => {
    const params: PerpDexStatusParameters[] = [{ dex: "test" }];

    const data = await Promise.all(params.map((p) => client.perpDexStatus(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "perpDexStatus",
  method: perpDexStatus,
  signature: "params",
  cases: [{ params: { dex: "test" } }],
  invalidParams: [{ dex: 1 }, {}],
});
