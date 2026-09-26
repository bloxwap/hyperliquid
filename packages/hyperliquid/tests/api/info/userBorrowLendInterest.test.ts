import {
  userBorrowLendInterest,
  type UserBorrowLendInterestParameters,
  UserBorrowLendInterestRequest,
} from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/userBorrowLendInterest.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserBorrowLendInterestResponse");
const paramsSchema = valibotToJsonSchema(v.omit(UserBorrowLendInterestRequest, ["type"]));

runTest({
  name: "userBorrowLendInterest",
  codeTestFn: async (_t, client) => {
    const now = Date.now();
    const fiveYears = 1000 * 60 * 60 * 24 * 365 * 5;
    const params: UserBorrowLendInterestParameters[] = [
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05", startTime: now - fiveYears },
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05", startTime: now - fiveYears, endTime: now },
      { user: "0xe019d6167E7e324aEd003d94098496b6d986aB05", startTime: now - fiveYears, endTime: null },
    ];

    const data = await Promise.all(params.map((p) => client.userBorrowLendInterest(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "userBorrowLendInterest",
  method: userBorrowLendInterest,
  signature: "params",
  cases: [
    { params: { user: "0x0000000000000000000000000000000000000001", startTime: 1000 } },
    { params: { user: "0x0000000000000000000000000000000000000001", startTime: 1000, endTime: 2000 } },
  ],
  invalidParams: [
    { user: "0x123", startTime: 1000 },
    { user: "0x0000000000000000000000000000000000000001", startTime: -1 },
    { user: "0x0000000000000000000000000000000000000001" },
  ],
});
