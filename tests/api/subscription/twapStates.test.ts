import {
  type TwapStatesEvent,
  type TwapStatesParameters,
  TwapStatesRequest,
} from "@bloxwap/hyperliquid/api/subscription";
import { getWalletAddress } from "@bloxwap/hyperliquid/signing";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { collectEventsOverTime, createTWAP, runTestWithExchange } from "./_t.ts";

const sourceFile = new URL("../../../src/api/subscription/_methods/twapStates.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "TwapStatesEvent");
const paramsSchema = valibotToJsonSchema(v.omit(TwapStatesRequest, ["type"]));

runTestWithExchange({
  name: "twapStates",
  fn: async (_t, client) => {
    const user = await getWalletAddress(
      "multiSigUser" in client.exch.config_ ? client.exch.config_.signers[0] : client.exch.config_.wallet,
    );
    const params: TwapStatesParameters[] = [{ user }, { user, dex: "" }];

    const data = await collectEventsOverTime<TwapStatesEvent>(async (cb) => {
      await Promise.all(params.map((p) => client.subs.twapStates(p, cb)));
      await createTWAP(client.exch);
    }, 10_000);

    schemaCoverage(paramsSchema, params);
    // trigger/stopPx always arrive as null on the wire (not settable via the current TWAP order
    // action), so their missing/non-null branches are uncoverable live.
    schemaCoverage(responseSchema, data, [
      "#/properties/states/items/items/1/properties/side/enum/1",
      "#/properties/states/items/items/1/properties/trigger/missing",
      "#/properties/states/items/items/1/properties/stopPx/missing",
      "#/properties/states/items/items/1/properties/stopPx/defined",
    ]);
  },
});
