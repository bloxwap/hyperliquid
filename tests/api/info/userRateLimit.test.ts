import { userRateLimit, type UserRateLimitParameters, UserRateLimitRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/userRateLimit.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserRateLimitResponse");
const paramsSchema = valibotToJsonSchema(v.omit(UserRateLimitRequest, ["type"]));

runTest({
  name: "userRateLimit",
  codeTestFn: async (_t, client) => {
    const params: UserRateLimitParameters[] = [{ user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9" }];

    const data = await Promise.all(params.map((p) => client.userRateLimit(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "userRateLimit",
  method: userRateLimit,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
