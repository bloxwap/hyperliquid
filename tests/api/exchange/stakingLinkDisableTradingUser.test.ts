import { ApiRequestError } from "@bloxwap/hyperliquid";
import {
  type StakingLinkDisableTradingUserParameters,
  StakingLinkDisableTradingUserRequest,
} from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(StakingLinkDisableTradingUserRequest.entries.action.entries), [
    "type",
    "signatureChainId",
    "hyperliquidChain",
    "nonce",
  ]),
);

runTest({
  name: "stakingLinkDisableTradingUser",
  codeTestFn: async (_t, exchClient) => {
    const params: StakingLinkDisableTradingUserParameters[] = [
      { tradingUser: "0x0000000000000000000000000000000000000001" },
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(
          async () => {
            await exchClient.stakingLinkDisableTradingUser(p);
          },
          ApiRequestError,
          "Staking link error",
        ),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});
