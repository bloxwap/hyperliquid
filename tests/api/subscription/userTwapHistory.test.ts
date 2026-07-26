import {
  type UserTwapHistoryEvent,
  type UserTwapHistoryParameters,
  UserTwapHistoryRequest,
} from "@bloxwap/hyperliquid/api/subscription";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { collectEventsOverTime, runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/subscription/_methods/userTwapHistory.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserTwapHistoryEvent");
const paramsSchema = valibotToJsonSchema(v.omit(UserTwapHistoryRequest, ["type"]));

runTest({
  name: "userTwapHistory",
  mode: "api",
  fn: async (_t, client) => {
    const params: UserTwapHistoryParameters[] = [
      { user: "0x563C175E6f11582f65D6d9E360A618699DEe14a9" },
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05" },
    ];

    const data = await collectEventsOverTime<UserTwapHistoryEvent>(async (cb) => {
      await Promise.all(params.map((p) => client.userTwapHistory(p, cb)));
    }, 10_000);

    schemaCoverage(paramsSchema, params);
    // trigger/stopPx always arrive as null on the wire (not settable via the current TWAP order
    // action), so their missing/non-null branches are uncoverable live.
    schemaCoverage(responseSchema, data, [
      "#/properties/isSnapshot/missing",
      "#/properties/history/items/properties/state/properties/trigger/missing",
      "#/properties/history/items/properties/state/properties/stopPx/missing",
      "#/properties/history/items/properties/state/properties/stopPx/defined",
    ]);
  },
});
