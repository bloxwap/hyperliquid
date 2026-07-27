import {
  borrowLendReserveState,
  type BorrowLendReserveStateParameters,
  BorrowLendReserveStateRequest,
} from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/borrowLendReserveState.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "BorrowLendReserveStateResponse");
const paramsSchema = valibotToJsonSchema(v.omit(BorrowLendReserveStateRequest, ["type"]));

runTest({
  name: "borrowLendReserveState",
  codeTestFn: async (_t, client) => {
    const params: BorrowLendReserveStateParameters[] = [{ token: 0 }];

    const data = await Promise.all(params.map((p) => client.borrowLendReserveState(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "borrowLendReserveState",
  method: borrowLendReserveState,
  signature: "params",
  cases: [{ params: { token: 1 } }],
  invalidParams: [{ token: -1 }, { token: "abc" }, {}],
});
