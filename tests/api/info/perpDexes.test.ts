import { perpDexes } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "perpDexes",
  method: perpDexes,
  signature: "none",
  // The alias sends the same wire request as `perpDexs`.
  cases: [{ params: {}, payload: { type: "perpDexs" } }],
});
