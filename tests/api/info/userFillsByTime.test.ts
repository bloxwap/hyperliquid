import { userFillsByTime, type UserFillsByTimeParameters, UserFillsByTimeRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/userFillsByTime.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserFillsByTimeResponse");
const paramsSchema = valibotToJsonSchema(v.omit(UserFillsByTimeRequest, ["type"]));

runTest({
  name: "userFillsByTime",
  codeTestFn: async (_t, client) => {
    const now = Date.now();
    const fiveYears = 1000 * 60 * 60 * 24 * 365 * 5;
    const params: UserFillsByTimeParameters[] = [
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", startTime: now - fiveYears },
      { user: "0x8172cc20bc3a55dcd07c75dd37ac0c2534de3b84", startTime: now - fiveYears },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", startTime: now - fiveYears, endTime: now },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", startTime: now - fiveYears, endTime: null },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", startTime: now - fiveYears, aggregateByTime: true },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", startTime: now - fiveYears, aggregateByTime: false },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", startTime: now - fiveYears, reversed: true },
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9", startTime: now - fiveYears, reversed: false },
    ];

    const data = await Promise.all(params.map((p) => client.userFillsByTime(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, ["#/items/properties/twapId/defined"]);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "userFillsByTime",
  method: userFillsByTime,
  signature: "params",
  cases: [
    { params: { user: "0x0000000000000000000000000000000000000001", startTime: 1000 } },
    {
      params: {
        user: "0x0000000000000000000000000000000000000001",
        startTime: 1000,
        endTime: 2000,
        aggregateByTime: true,
        reversed: false,
      },
    },
  ],
  invalidParams: [
    { user: "0x123", startTime: 1000 },
    { user: "0x0000000000000000000000000000000000000001", startTime: -1 },
    { user: "0x0000000000000000000000000000000000000001" },
  ],
});
