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
  isTestnet: false,
  fn: async (_t, client) => {
    const params: UserTwapHistoryParameters[] = [
      { user: "0x03ce7863a2b62f4e227fd98605b79beb32618c76" }, // trigger.above: true
      { user: "0x0132157369b0d073dd99011da1777920a025fd77" }, // trigger.above: false
      { user: "0x051748895c6ed4fab50828bebe8e62e665134d23" }, // stopped and non-null stopPx
      { user: "0x06d5af06a3a7d29909e1cdc7a9deded2fb14ab57" }, // additional triggered TWAPs
    ];

    const data = await collectEventsOverTime<UserTwapHistoryEvent>(async (cb) => {
      await Promise.all(params.map((p) => client.userTwapHistory(p, cb)));
    }, 10_000);

    schemaCoverage(paramsSchema, params);
    // Snapshots contain fewer entries than REST history and can omit errors and older entries
    // without trigger/stopPx or twapId. The offline twapHistory fixtures cover those branches
    // of the shared response type; these live accounts exercise trigger and stop prices/statuses.
    schemaCoverage(responseSchema, data, [
      "#/properties/isSnapshot/missing",
      "#/properties/history/items/properties/state/properties/trigger/missing",
      "#/properties/history/items/properties/state/properties/stopPx/missing",
      "#/properties/history/items/properties/status/anyOf/1",
      "#/properties/history/items/properties/twapId/missing",
    ]);
  },
});
