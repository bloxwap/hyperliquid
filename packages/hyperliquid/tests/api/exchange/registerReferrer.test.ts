import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type RegisterReferrerParameters, RegisterReferrerRequest } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(v.omit(v.object(RegisterReferrerRequest.entries.action.entries), ["type"]));

runTest({
  name: "registerReferrer",
  codeTestFn: async (_t, exchClient) => {
    const params: RegisterReferrerParameters[] = [{ code: "TEST" }];

    await Promise.all(
      params.map((p) =>
        assertRejects(
          async () => {
            await exchClient.registerReferrer(p);
          },
          ApiRequestError,
          "Cannot generate referral code until enough volume traded",
        ),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});
