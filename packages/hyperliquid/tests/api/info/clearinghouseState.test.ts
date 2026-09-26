import {
  clearinghouseState,
  type ClearinghouseStateParameters,
  ClearinghouseStateRequest,
} from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/clearinghouseState.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "ClearinghouseStateResponse");
const paramsSchema = valibotToJsonSchema(v.omit(ClearinghouseStateRequest, ["type"]));

runTest({
  name: "clearinghouseState",
  codeTestFn: async (_t, client) => {
    const params: ClearinghouseStateParameters[] = [
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9" },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", dex: "gato" },
    ];

    const data = await Promise.all(params.map((p) => client.clearinghouseState(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "clearinghouseState",
  method: clearinghouseState,
  signature: "params",
  cases: [
    { params: { user: "0x0000000000000000000000000000000000000001" } },
    { params: { user: "0x0000000000000000000000000000000000000001", dex: "test" } },
  ],
  invalidParams: [{ user: "0x123" }, { user: "0x0000000000000000000000000000000000000001", dex: 123 }],
});
