import { expect, test } from "bun:test";
import Ajv from "ajv";
import { HttpTransport } from "@bloxwap/hyperliquid";
import { userStarState } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { OFFLINE } from "../../_offline.ts";
const user = "0x0c839e7f21c712e64f80ca0775ec1f35a43af3ee";
runOfflineMethodTests({
  name: "userStarState",
  method: userStarState,
  signature: "params",
  cases: [{ params: { user } }],
  invalidParams: [{}, { user: "invalid" }],
});
const schema = typeToJsonSchema(
  new URL("../../../src/api/info/_methods/userStarState.ts", import.meta.url).pathname,
  "UserStarStateResponse",
);
const validate = new Ajv({ strict: false }).compile(schema);
test("observed nonempty tuple response and approved/null states validate", () => {
  expect(validate({ dexToState: [["nimb", null]] })).toBe(true);
  expect(validate({ dexToState: [["test", { isReduceOnly: false, isBackstopLiquidatorDepositAllowed: true }]] })).toBe(
    true,
  );
  expect(validate({ dexToState: [] })).toBe(true);
  expect(validate({ dexToState: { test: null } })).toBe(false);
});
test.skipIf(OFFLINE)("read-only testnet userStarState preserves server tuples", async () => {
  const result = await userStarState({ transport: new HttpTransport({ isTestnet: true }) }, { user });
  expect(Array.isArray(result.dexToState)).toBe(true);
  expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
});
