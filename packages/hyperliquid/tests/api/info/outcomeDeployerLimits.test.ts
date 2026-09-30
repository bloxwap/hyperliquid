import { expect, test } from "bun:test";
import { outcomeDeployerLimits } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import { HttpTransport } from "@bloxwap/hyperliquid";
import { OFFLINE } from "../../_offline.ts";
runOfflineMethodTests({
  name: "outcomeDeployerLimits",
  method: outcomeDeployerLimits,
  signature: "params",
  cases: [{ params: { venue: "cat" } }],
  invalidParams: [{}, { venue: "" }, { venue: 12 }],
});
test.skipIf(OFFLINE)("outcomeDeployerLimits read-only testnet capacity", async () => {
  const data = await outcomeDeployerLimits({ transport: new HttpTransport({ isTestnet: true }) }, { venue: "cat" });
  expect(Number.isInteger(data.nDailyOutcomesRemaining)).toBe(true);
  expect(Number.isInteger(data.nActiveOutcomesRemaining)).toBe(true);
});
