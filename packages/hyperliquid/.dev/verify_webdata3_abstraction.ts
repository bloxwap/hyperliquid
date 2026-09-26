/**
 * Live verification for bloxwap/hyperliquid#82: does the `webData3` WS channel carry the same
 * abstraction state as the REST `userAbstraction` info request?
 *
 * For a sample of active mainnet traders (taken from `recentTrades` — no address list is
 * hardcoded), this script reads REST `userAbstraction` and the first `webData3` frame, then
 * prints a side-by-side comparison. It answers three questions:
 *
 * 1. Does the server populate `userState.abstraction` on `webData3` at all?
 * 2. Does its value match REST `userAbstraction` for the same account?
 * 3. What happens for accounts where REST reports `"default"` — a value the SDK's
 *    `WebData3Event` type does not model (its union lacks `"default"`)?
 *
 * A match on all three means the monorepo's `use-live-account-summary.ts` REST backstop is a
 * candidate for retirement; a mismatch or an absent field means it stays.
 *
 * Note: this verifies steady-state equivalence. The issue's second requirement — observing the
 * channel across an account abstraction *migration* — is a soak test and cannot be run on demand.
 *
 * Usage: bun run .dev/verify_webdata3_abstraction.ts
 *
 * @module
 */

import { HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from "../src/mod.ts";
import type { WebData3Event } from "../src/api/subscription/_methods/webData3.ts";

/** Active traders to sample (bounded by the 15-unique-users per-connection limit). */
const SAMPLE_SIZE = 12;
/** How long to wait for a user's first webData3 frame before declaring it absent. */
const FRAME_TIMEOUT_MS = 15_000;

const http = new HttpTransport();
const info = new InfoClient({ transport: http });

// --- 1. Sample active traders from public market data -------------------------------
const trades = await info.recentTrades({ coin: "BTC" });
const users = [...new Set(trades.flatMap((t) => t.users))].slice(0, SAMPLE_SIZE);
console.log(`Sampling ${users.length} active traders from recent BTC trades\n`);

// --- 2. REST reads -------------------------------------------------------------------
const rest = new Map(users.map((user) => [user, info.userAbstraction({ user })]));

// --- 3. First webData3 frame per user -------------------------------------------------
const ws = new WebSocketTransport();
await ws.ready();
const subs = new SubscriptionClient({ transport: ws });

interface WsObservation {
  frameReceived: boolean;
  abstractionPresent: boolean;
  abstraction?: string;
  agentAddress?: string | null;
  cumLedgerPresent?: boolean;
}

function observe(user: `0x${string}`): Promise<WsObservation> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ frameReceived: false, abstractionPresent: false }), FRAME_TIMEOUT_MS);
    subs
      .webData3({ user }, (event: WebData3Event) => {
        clearTimeout(timer);
        const state = event.userState;
        resolve({
          frameReceived: true,
          abstractionPresent: "abstraction" in state,
          abstraction: state.abstraction,
          agentAddress: state.agentAddress,
          cumLedgerPresent: typeof state.cumLedger === "string",
        });
      })
      .catch((error) => {
        clearTimeout(timer);
        console.error(`  webData3 subscribe failed for ${user}: ${error}`);
        resolve({ frameReceived: false, abstractionPresent: false });
      });
  });
}

// --- 4. Side-by-side comparison --------------------------------------------------------
console.log("address                                     REST userAbstraction  WS abstraction   match");
console.log("─".repeat(100));
let mismatches = 0;
for (const user of users) {
  const [restValue, wsObs] = await Promise.all([rest.get(user)!, observe(user)]);
  const wsValue = !wsObs.frameReceived ? "(no frame)" : wsObs.abstractionPresent ? wsObs.abstraction : "(field absent)";
  const match = wsObs.frameReceived && wsObs.abstractionPresent && wsObs.abstraction === restValue;
  if (!match) mismatches++;
  console.log(`${user}  ${String(restValue).padEnd(19)}  ${String(wsValue).padEnd(15)}  ${match ? "yes" : "NO"}`);
}

await ws.close();

console.log(`\n${"─".repeat(100)}`);
if (mismatches === 0) {
  console.log("RESULT: webData3.userState.abstraction matched REST userAbstraction for every sampled account.");
  console.log("The REST backstop is a retirement candidate (migration soak test still outstanding).");
} else {
  console.log(`RESULT: ${mismatches}/${users.length} accounts diverged — the REST backstop must stay.`);
  process.exit(1);
}
