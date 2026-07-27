import {
  perpsAtOpenInterestCap,
  type PerpsAtOpenInterestCapParameters,
  PerpsAtOpenInterestCapRequest,
} from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/perpsAtOpenInterestCap.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "PerpsAtOpenInterestCapResponse");
const paramsSchema = valibotToJsonSchema(v.omit(PerpsAtOpenInterestCapRequest, ["type"]));

runTest({
  name: "perpsAtOpenInterestCap",
  codeTestFn: async (_t, client) => {
    const params: PerpsAtOpenInterestCapParameters[] = [{}, { dex: "gato" }];

    const data = await Promise.all(params.map((p) => client.perpsAtOpenInterestCap(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, ["#/array"]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "perpsAtOpenInterestCap",
  method: perpsAtOpenInterestCap,
  signature: "overloaded",
  cases: [{ params: { dex: "test" } }],
  invalidParams: [{ dex: 123 }],
});
