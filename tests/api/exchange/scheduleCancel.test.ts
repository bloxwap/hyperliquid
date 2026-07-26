import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type ScheduleCancelParameters, ScheduleCancelRequest } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(v.omit(v.object(ScheduleCancelRequest.entries.action.entries), ["type"]));

runTest({
  name: "scheduleCancel",
  codeTestFn: async (_t, exchClient) => {
    const params: ScheduleCancelParameters[] = [
      // time=defined
      { time: Date.now() + 30000 },
      // time=missing
      {},
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(
          async () => {
            await exchClient.scheduleCancel(p);
          },
          ApiRequestError,
          "Cannot set scheduled cancel time until enough volume traded",
        ),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});
