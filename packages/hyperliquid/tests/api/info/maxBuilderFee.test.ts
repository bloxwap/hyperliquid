import { maxBuilderFee, type MaxBuilderFeeParameters, MaxBuilderFeeRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/maxBuilderFee.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "MaxBuilderFeeResponse");
const paramsSchema = valibotToJsonSchema(v.omit(MaxBuilderFeeRequest, ["type"]));

runTest({
  name: "maxBuilderFee",
  codeTestFn: async (_t, client) => {
    const params: MaxBuilderFeeParameters[] = [
      {
        user: "0xe019d6167E7e324aEd003d94098496b6d986aB05",
        builder: "0xe019d6167E7e324aEd003d94098496b6d986aB05",
      },
    ];

    const data = await Promise.all(params.map((p) => client.maxBuilderFee(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "maxBuilderFee",
  method: maxBuilderFee,
  signature: "params",
  cases: [
    {
      params: {
        user: "0x0000000000000000000000000000000000000001",
        builder: "0x0000000000000000000000000000000000000002",
      },
    },
  ],
  invalidParams: [
    { user: "0x123", builder: "0x0000000000000000000000000000000000000002" },
    { user: "0x0000000000000000000000000000000000000001", builder: "0x456" },
  ],
});
