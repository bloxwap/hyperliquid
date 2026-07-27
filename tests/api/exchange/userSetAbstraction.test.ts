import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type UserSetAbstractionParameters, UserSetAbstractionRequest } from "@bloxwap/hyperliquid/api/exchange";
import { getWalletAddress } from "@bloxwap/hyperliquid/signing";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/userSetAbstraction.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserSetAbstractionSuccessResponse");
const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(UserSetAbstractionRequest.entries.action.entries), [
    "type",
    "signatureChainId",
    "hyperliquidChain",
    "nonce",
  ]),
);

runTest({
  name: "userSetAbstraction",
  codeTestFn: async (_t, exchClient) => {
    const user =
      "multiSigUser" in exchClient.config_
        ? exchClient.config_.multiSigUser
        : await getWalletAddress(exchClient.config_.wallet);

    const params: UserSetAbstractionParameters[] = [
      { user, abstraction: "disabled" },
      { user, abstraction: "unifiedAccount" },
      { user, abstraction: "portfolioMargin" },
    ];

    const data = [await exchClient.userSetAbstraction(params[0]), await exchClient.userSetAbstraction(params[1])];
    await assertRejects(
      () => exchClient.userSetAbstraction(params[2]),
      ApiRequestError,
      "Portfolio margin requires account value of $10000 or total volume of $5000000.",
    );

    // "dexAbstraction" is accepted server-side (verified against the exchange deserializer)
    // but flipping the shared live test account into that mode would leak into other tests.
    schemaCoverage(paramsSchema, params, ["#/properties/abstraction/enum/3"]);
    schemaCoverage(responseSchema, data);
  },
});
