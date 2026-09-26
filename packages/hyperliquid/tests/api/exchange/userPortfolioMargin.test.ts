import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type UserPortfolioMarginParameters, UserPortfolioMarginRequest } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(UserPortfolioMarginRequest.entries.action.entries), [
    "type",
    "signatureChainId",
    "hyperliquidChain",
    "nonce",
  ]),
);

runTest({
  name: "userPortfolioMargin",
  codeTestFn: async (_t, exchClient) => {
    const params: UserPortfolioMarginParameters[] = [
      {
        user: "0xcb3f0bd249a89e45e86a44bcfc7113e4ffe84cd1",
        enabled: true,
      },
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(
          async () => {
            await exchClient.userPortfolioMargin(p);
          },
          ApiRequestError,
          "Sub-account 0xcb3f0bd249a89e45e86a44bcfc7113e4ffe84cd1 is not registered to",
        ),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});
