/**
 * Live migration soak test for the webData3 abstraction lane (bloxwap/hyperliquid#82 follow-up).
 *
 * The steady-state check (`.dev/verify_webdata3_abstraction.ts`) proved webData3's
 * `userState.abstraction` matches REST `userAbstraction` value-for-value, with the field ABSENT
 * in the default state. What it could not prove is the migration case: does the channel push the
 * NEW model when an account flips abstraction, and how fast?
 *
 * This script answers it on testnet with a throwaway wallet:
 *   1. fresh account → REST says "default", first webData3 frame omits the field;
 *   2. `userSetAbstraction("unifiedAccount")` → expect a webData3 frame carrying
 *      `abstraction: "unifiedAccount"`, and REST agreeing;
 *   3. flip back to "disabled" → expect `abstraction: "disabled"` on both.
 *
 * A pass means the monorepo's REST `userAbstraction` read can be retired outright (no soak
 * caveat left): the channel delivers the initial state, steady-state changes, and migrations.
 *
 * Usage: bun run .dev/verify_webdata3_abstraction_migration.ts
 *
 * @module
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ExchangeClient, HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from "../src/mod.ts";
import type { WebData3Event } from "../src/api/subscription/_methods/webData3.ts";

const FRAME_TIMEOUT_MS = 30_000;

const wallet = privateKeyToAccount(generatePrivateKey());
const user = wallet.address;
console.log(`Throwaway testnet wallet: ${user}\n`);

const http = new HttpTransport({ isTestnet: true });
const info = new InfoClient({ transport: http });
const exchange = new ExchangeClient({ transport: http, wallet });

const ws = new WebSocketTransport({ isTestnet: true });
await ws.ready();
const subs = new SubscriptionClient({ transport: ws });

/** Resolves with the next webData3 frame whose `abstraction` equals `want` ("absent" matches a missing field). */
function awaitAbstraction(want: string | "absent"): Promise<{ event: WebData3Event; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setTimeout(() => reject(new Error(`timed out waiting for abstraction=${want}`)), FRAME_TIMEOUT_MS);
    subs
      .webData3({ user }, (event) => {
        const value = "abstraction" in event.userState ? event.userState.abstraction : "absent";
        console.log(`  frame: abstraction=${value} (t+${((performance.now() - started) / 1000).toFixed(1)}s)`);
        if (value === want) {
          clearTimeout(timer);
          resolve({ event, latencyMs: performance.now() - started });
        }
      })
      .catch(reject);
  });
}

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

// --- 1. Fresh account: REST "default", WS field absent --------------------------------
const initialRest = await info.userAbstraction({ user });
check(`fresh account: REST userAbstraction = "default" (got "${initialRest}")`, initialRest === "default");

const firstFrame = await awaitAbstraction("absent");
check("fresh account: first webData3 frame omits `abstraction`", true);

// --- 2. Migrate to unifiedAccount --------------------------------------------------------
console.log('\nuserSetAbstraction("unifiedAccount")…');
const flip1 = await exchange.userSetAbstraction({ user, abstraction: "unifiedAccount" });
check(`action accepted (status "${flip1.status}")`, flip1.status === "ok");

const [migrated] = await Promise.all([
  awaitAbstraction("unifiedAccount"),
  // REST read after the WS frame lands keeps the comparison honest without racing the action.
]);
check("webData3 pushed the migration (abstraction = unifiedAccount)", true);
console.log(`  migration latency (action → WS frame): ${(migrated.latencyMs / 1000).toFixed(2)}s`);

const restAfterFlip = await info.userAbstraction({ user });
check(`REST agrees after migration (got "${restAfterFlip}")`, restAfterFlip === "unifiedAccount");

// --- 3. Flip back to disabled --------------------------------------------------------------
console.log('\nuserSetAbstraction("disabled")…');
const flip2 = await exchange.userSetAbstraction({ user, abstraction: "disabled" });
check(`action accepted (status "${flip2.status}")`, flip2.status === "ok");

await awaitAbstraction("disabled");
check("webData3 pushed the second migration (abstraction = disabled)", true);

const restFinal = await info.userAbstraction({ user });
check(`REST agrees after second migration (got "${restFinal}")`, restFinal === "disabled");

await ws.close();
console.log(
  failures === 0
    ? "\nRESULT: webData3 covers initial state, steady state, and migrations."
    : `\nRESULT: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
