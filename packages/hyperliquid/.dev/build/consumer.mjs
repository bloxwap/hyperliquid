import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as root from "@bloxwap/hyperliquid";
import { ExchangeClient } from "@bloxwap/hyperliquid/api/exchange/client";
import { ApiRequestError } from "@bloxwap/hyperliquid/api/exchange";
import { HttpTransport } from "@bloxwap/hyperliquid/transport/http";
import { systemRuntime } from "@bloxwap/hyperliquid/transport/runtime";
import { allMids } from "@bloxwap/hyperliquid/api/info/allMids";
import { buildOrder } from "@bloxwap/hyperliquid/actions/order";
import { order } from "@bloxwap/hyperliquid/api/exchange/order";
import { signAction, submitAction } from "@bloxwap/hyperliquid/actions/execution";
import { fastAssetCtxs as barrelFastAssetCtxs } from "@bloxwap/hyperliquid/api/subscription";
import { fastAssetCtxs as individualFastAssetCtxs } from "@bloxwap/hyperliquid/api/subscription/fastAssetCtxs";

assert.equal(root.ExchangeClient, ExchangeClient);
assert.equal(root.HttpTransport, HttpTransport);
assert.equal(root.ApiRequestError, ApiRequestError);
assert.equal(root.systemRuntime, systemRuntime);
assert.equal(barrelFastAssetCtxs, individualFastAssetCtxs);
const expectedEntries = JSON.parse(readFileSync(new URL("./entries.json", import.meta.url), "utf8"));
for (const [specifier, expected] of Object.entries(expectedEntries)) {
  assert.deepEqual(Object.keys(await import(specifier)).sort(), expected, specifier);
}
for (const path of ["actions/_canonical", "api/exchange/_base/execute", "api/info/_base/_config"]) {
  await assert.rejects(import(`@bloxwap/hyperliquid/${path}`));
}
const nonces = [];
let signCount = 0;
let failure = false;
const transport = {
  isTestnet: true,
  async request(endpoint, body) {
    if (endpoint === "info") return { BTC: "1" };
    nonces.push(body.nonce);
    if (failure) return { status: "err", response: "test failure" };
    return { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } };
  },
};
const config = {
  transport,
  wallet: {
    address: `0x${"42".repeat(20)}`,
    async signTypedData() {
      signCount++;
      return `0x${"11".repeat(64)}1b`;
    },
  },
};
const client = new root.ExchangeClient(config);
const params = { orders: [{ a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" } } }] };
const action = buildOrder(params);
assert(Object.isFrozen(action.payload.orders));
assert.deepEqual(await allMids({ transport }), { BTC: "1" });
const signed = await client.sign(action);
assert.equal(nonces.length, 0);
await submitAction(config, signed);
assert.equal(signCount, 1);
await client.submit(await signAction(config, action));
await Promise.all([client.execute(action), order(config, params)]);
assert.equal(new Set(nonces).size, nonces.length);
failure = true;
await assert.rejects(client.execute(action), ApiRequestError);
console.log("Published consumer imports, identities, nonce sharing, signing ownership, and error types passed.");
