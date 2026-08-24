import {
  borrowLendUserState,
  type BorrowLendUserStateParameters,
  BorrowLendUserStateRequest,
} from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { describe, test } from "bun:test";
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
    // The live account is healthy with no observed non-null healthFactor; the offline block
    // below covers the other health states and a numeric healthFactor (issue #101).
    schemaCoverage(responseSchema, data, [
      "#/properties/health/enum/1",
      "#/properties/health/enum/2",
      "#/properties/health/enum/3",
      "#/properties/healthFactor/defined",
    ]);
  },
});

// ============================================================
// Offline: response schema — health states and healthFactor (issue #101)
// ============================================================

describe("borrowLendUserState (offline)", () => {
  test("all health states satisfy the response schema", () => {
    const state = {
      borrow: { basis: "0.0", value: "0.0" },
      supply: { basis: "100.0", value: "100.0" },
    };
    const samples = [
      { tokenToState: [[0, state]], health: "healthy", healthFactor: null },
      { tokenToState: [[0, state]], health: "atRisk", healthFactor: "1.05" },
      { tokenToState: [[1, state]], health: "marketLiquidatable", healthFactor: "0.98" },
      { tokenToState: [], health: "backstopLiquidatable", healthFactor: "0.5" },
    ];
    schemaCoverage(responseSchema, samples);
  });
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
