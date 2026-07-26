import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type LinkStakingUserParameters, LinkStakingUserRequest } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(LinkStakingUserRequest.entries.action.entries), [
    "type",
    "signatureChainId",
    "hyperliquidChain",
    "nonce",
  ]),
);

runTest({
  name: "linkStakingUser",
  codeTestFn: async (_t, exchClient) => {
    const params: LinkStakingUserParameters[] = [
      // isFinalize=false
      { user: "0x0000000000000000000000000000000000000001", isFinalize: false },
      // isFinalize=true
      { user: "0x0000000000000000000000000000000000000001", isFinalize: true },
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(
          async () => {
            await exchClient.linkStakingUser(p);
          },
          ApiRequestError,
          "Staking link error",
        ),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});
