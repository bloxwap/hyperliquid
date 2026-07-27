import {
  borrowLendUserState,
  type BorrowLendUserStateParameters,
  BorrowLendUserStateRequest,
} from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/borrowLendUserState.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "BorrowLendUserStateResponse");
const paramsSchema = valibotToJsonSchema(v.omit(BorrowLendUserStateRequest, ["type"]));

runTest({
  name: "borrowLendUserState",
  codeTestFn: async (_t, client) => {
    const params: BorrowLendUserStateParameters[] = [{ user: "0xcb3f0bd249a89e45e86a44bcfc7113e4ffe84cd1" }];

    const data = await Promise.all(params.map((p) => client.borrowLendUserState(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "borrowLendUserState",
  method: borrowLendUserState,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
