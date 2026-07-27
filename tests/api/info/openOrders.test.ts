import { openOrders, type OpenOrdersParameters, OpenOrdersRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/openOrders.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "OpenOrdersResponse");
const paramsSchema = valibotToJsonSchema(v.omit(OpenOrdersRequest, ["type"]));

runTest({
  name: "openOrders",
  codeTestFn: async (_t, client) => {
    const params: OpenOrdersParameters[] = [
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9" },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", dex: "gato" },
    ];

    const data = await Promise.all(params.map((p) => client.openOrders(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, ["#/items/properties/cloid/present"]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "openOrders",
  method: openOrders,
  signature: "params",
  cases: [
    { params: { user: "0x0000000000000000000000000000000000000001" } },
    { params: { user: "0x0000000000000000000000000000000000000001", dex: "test" } },
  ],
  invalidParams: [{ user: "0x123" }, { user: "0x0000000000000000000000000000000000000001", dex: 123 }],
});
