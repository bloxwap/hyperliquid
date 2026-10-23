import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import * as root from "@bloxwap/hyperliquid";
import { ExchangeClient } from "@bloxwap/hyperliquid/api/exchange/client";
import { ApiRequestError } from "@bloxwap/hyperliquid/api/exchange";
import { HttpRequestError, HttpTransport } from "@bloxwap/hyperliquid/transport/http";
import { TransportError } from "@bloxwap/hyperliquid/transport";
import { AbstractWalletError, CanonicalizeError } from "@bloxwap/hyperliquid/signing";
import { systemRuntime } from "@bloxwap/hyperliquid/transport/runtime";
import { allMids } from "@bloxwap/hyperliquid/api/info/allMids";
import { buildOrder } from "@bloxwap/hyperliquid/actions/order";
import { order } from "@bloxwap/hyperliquid/api/exchange/order";
import { signAction, submitAction } from "@bloxwap/hyperliquid/actions/execution";
import { fastAssetCtxs as barrelFastAssetCtxs } from "@bloxwap/hyperliquid/api/subscription";
import { fastAssetCtxs as individualFastAssetCtxs } from "@bloxwap/hyperliquid/api/subscription/fastAssetCtxs";
import { SubscriptionClient as IndividualSubscriptionClient } from "@bloxwap/hyperliquid/api/subscription/client";
import { unsubscribeAll as individualUnsubscribeAll } from "@bloxwap/hyperliquid/api/subscription/unsubscribeAll";

assert.equal(root.ExchangeClient, ExchangeClient);
assert.equal(root.HttpTransport, HttpTransport);
assert.equal(root.HttpRequestError, HttpRequestError);
assert.equal(root.TransportError, TransportError);
for (const ErrorClass of [TransportError, AbstractWalletError, CanonicalizeError]) {
  assert(new ErrorClass("identity check") instanceof root.HyperliquidError);
}
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
assert.throws(
  () => allMids({ transport }, { dex: 1 }),
  (error) =>
    error instanceof root.ValidationError && error instanceof root.HyperliquidError && error.cause.name === "ValiError",
);
const signed = await client.sign(action);
assert.equal(nonces.length, 0);
await submitAction(config, signed);
assert.equal(signCount, 1);
await client.submit(await signAction(config, action));
await Promise.all([client.execute(action), order(config, params)]);
assert.equal(new Set(nonces).size, nonces.length);
failure = true;
await assert.rejects(
  client.execute(action),
  (error) => error instanceof ApiRequestError && error instanceof root.HyperliquidError,
);
console.log("Published consumer imports, identities, nonce sharing, signing ownership, and error types passed.");

// Mixed published entry points must share decoder identity and client teardown scope.
const listeners = new Map();
const subscriptionTransport = {
  async subscribe(_channel, _payload, listener) {
    listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
    let active = true;
    return {
      async unsubscribe() {
        if (!active) return;
        active = false;
        const remaining = listeners.get(listener) - 1;
        if (remaining === 0) listeners.delete(listener);
        else listeners.set(listener, remaining);
      },
    };
  },
};
const rawPrices = [];
const clientPrices = [];
const otherPrices = [];
const rawFeed = await individualFastAssetCtxs({ transport: subscriptionTransport }, (data) => {
  rawPrices.push(data.COIN.markPx);
  data.COIN.markPx = "changed";
});
await new root.SubscriptionClient({ transport: subscriptionTransport }).fastAssetCtxs((data) => {
  clientPrices.push(data.COIN.markPx);
});
await new IndividualSubscriptionClient({ transport: subscriptionTransport }).fastAssetCtxs((data) => {
  otherPrices.push(data.COIN.markPx);
});
assert.equal(listeners.size, 1, "one decode callback across root/client/function entry points");
const deliver = (price) => {
  const payload = deflateRawSync(JSON.stringify({ COIN: { markPx: price } })).toString("base64");
  for (const listener of listeners.keys()) listener(new CustomEvent("fastAssetCtxs", { detail: payload }));
};
deliver("1");
assert.deepEqual(rawPrices, ["1"]);
assert.deepEqual(clientPrices, ["1"]);
assert.deepEqual(otherPrices, ["1"]);
await individualUnsubscribeAll({ transport: subscriptionTransport });
deliver("2");
assert.deepEqual(rawPrices, ["1", "2"]);
assert.deepEqual(clientPrices, ["1"]);
assert.deepEqual(otherPrices, ["1"]);
await rawFeed.unsubscribe();
assert.equal(listeners.size, 0);
console.log("Published mixed-entry subscription decoding, isolation, and lease tracking passed.");
