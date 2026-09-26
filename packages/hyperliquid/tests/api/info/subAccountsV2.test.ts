import { subAccountsV2 } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "subAccountsV2",
  method: subAccountsV2,
  signature: "params",
  cases: [
    {
      params: { user: "0x0000000000000000000000000000000000000001" },
      // The alias sends the same wire request as `subAccounts2`.
      payload: { type: "subAccounts2", user: "0x0000000000000000000000000000000000000001" },
    },
  ],
  invalidParams: [{ user: "0x123" }, {}],
});
