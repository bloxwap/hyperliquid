---
title: Clients
description: Use the Info, Exchange, Subscription, and Explorer clients to work with the Hyperliquid API.
---

# Clients

A client uses a [transport](transports.md) to call a specific part of the Hyperliquid API:

| API                                                                                                            | What it covers                                  | Client                                           |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| [**Info**](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)                   | market data, account state                      | [`InfoClient`](#info-endpoint)                   |
| [**Exchange**](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)           | trading, fund management, account configuration | [`ExchangeClient`](#exchange-endpoint)           |
| [**Subscription**](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) | real-time updates via WebSocket                 | [`SubscriptionClient`](#websocket-subscriptions) |
| [**Explorer**](https://app.hyperliquid.xyz/explorer)                                                           | blocks, transactions, and address activity      | [`ExplorerClient`](#explorer-endpoint)           |

## Info endpoint

`InfoClient` is read-only and works with any transport. See all
[Info methods](https://nktkas.gitbook.io/hyperliquid/api-reference/info-methods).

```ts
import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";

const transport = new HttpTransport();
const client = new InfoClient({ transport });

const book = await client.l2Book({ coin: "ETH" });
```

### Pagination of time-ranged endpoints

Time-ranged responses are capped server-side: at most 500 elements for most endpoints
([docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#pagination)), 2000 fills for
`userFillsByTime`. The `*All` helpers page through a range for you — since `startTime` is inclusive, each follow-up
request starts at the last returned timestamp and the helper discards the overlap, so a page capped in the middle of a
same-millisecond cluster is neither skipped nor duplicated:

```ts
// Every fill in the range, not just the first 2000
const fills = await client.userFillsByTimeAll({
  user: "0x...",
  startTime: Date.now() - 1000 * 60 * 60 * 24 * 30,
});

// Bound the number of requests with `maxPages` (default 100, must be a positive integer)
const funding = await client.fundingHistoryAll({ coin: "ETH", startTime: 0 }, { maxPages: 10 });
```

Helpers exist for `userFillsByTime`, `userTwapSliceFillsByTime`, `fundingHistory`, `userNonFundingLedgerUpdates`, and
`candleSnapshot`. Server-side availability windows still apply and are not pagination caps: only the 10000 most recent
fills and the most recent 5000 candles exist at all, so `candleSnapshotAll` walks until exhaustion within that window
and cannot reach older history. `historicalOrders` (at most 2000 most recent orders) takes no time range and cannot be
paginated. `userFillsByTimeAll` rejects `reversed: true`: the walk moves forward from `startTime` and needs ascending
pages.

#### Streaming pages instead of buffering

The `*All` helpers buffer the whole range into one array. When the range is large — or you want to process, persist,
or render results incrementally — use the matching `*Pages` variant instead. It runs the same walk as a lazy async
generator: nothing is requested until iteration starts, each page is yielded as it arrives (boundary overlap already
removed), and `break` stops the walk without issuing further requests:

```ts
// Pages arrive one at a time; memory stays bounded by one page, not the whole range
for await (const page of client.userFillsByTimePages({
  user: "0x...",
  startTime: Date.now() - 1000 * 60 * 60 * 24 * 30,
})) {
  await storeFills(page); // process and discard — no giant buffer
  if (enough) break; // stops the walk: no further requests are made
}
```

Every `*All` helper has a `*Pages` twin with the same parameters and options (`userFillsByTimePages`,
`userTwapSliceFillsByTimePages`, `fundingHistoryPages`, `userNonFundingLedgerUpdatesPages`, `candleSnapshotPages`).
The buffered helpers are thin collectors over the generators, so both forms share the same boundary handling,
`maxPages` bound, and availability-window caveats.

### Caching slow-changing metadata

Info responses are never cached by default. If your app polls metadata endpoints (`meta`, `spotMeta`, …) in a loop,
wrap the transport in `InfoCacheTransport` — an opt-in TTL cache that works over both HTTP and WebSocket transports and
leaves every non-allowlisted request untouched:

```ts
import { HttpTransport, InfoCacheTransport, InfoClient } from "@bloxwap/hyperliquid";

const transport = new InfoCacheTransport(new HttpTransport(), {
  ttl: 60_000, // default TTL for every cached endpoint (1 minute)
  ttlByType: { marginTable: 600_000 }, // per-endpoint overrides
});
const client = new InfoClient({ transport });

await client.meta(); // hits the network
await client.meta(); // served from cache until the TTL expires
```

Only a conservative allowlist of listing- or deployment-driven endpoints is cached — `meta`, `spotMeta`,
`allPerpMetas`, `perpDexs`, `marginTable`, `tokenDetails`, `outcomeMeta`, `outcomeTemplates`. Responses with live
market data (`metaAndAssetCtxs`, `spotMetaAndAssetCtxs`), exchange status, user state, and order books always pass
through uncached. Cache keys incorporate the request params, so e.g. `marginTable` with different `id`/`dex` values
never collide, and concurrent identical calls share one in-flight request.

Metadata changes are rare but unannounced (new listings, new DEXs), so the useful TTL band is seconds to minutes:
30 s – 5 min for the `meta` family and `outcomeMeta`; 5 – 10 min or more for the near-static `marginTable`,
`perpDexs`, `tokenDetails`, and `outcomeTemplates`. The default is 60 s. Call `transport.clear()` to force a refetch
of everything.

Two interactions to be aware of:

- `SymbolConverter` fetches `meta`/`spotMeta`/`perpDexs`/`outcomeMeta` through whatever transport it is given. With a
  caching transport, its `reload()` serves cached data within the TTL — give the converter its own unwrapped transport,
  or call `clear()` first, when a reload must see fresh listings.
- `InfoCacheTransport` implements only the request interface. When wrapping a `WebSocketTransport`, pass the raw
  WebSocket transport to `SubscriptionClient` and the wrapped one to `InfoClient`.

### Sharing identical in-flight requests

When several parts of a process request the same live data at the same time (a UI and a strategy both polling
`l2Book`, say), the `coalesce` option lets identical concurrent requests share one network round trip, without caching
anything:

```ts
import { HttpTransport, InfoCacheTransport, InfoClient } from "@bloxwap/hyperliquid";

const transport = new InfoCacheTransport(new HttpTransport(), {
  coalesce: ["l2Book", "allMids", "clearinghouseState"], // or `true` for every info request type
});
const client = new InfoClient({ transport });

// One request goes out; both callers get its response.
const [a, b] = await Promise.all([client.l2Book({ coin: "BTC" }), client.l2Book({ coin: "BTC" })]);
```

Each joined duplicate saves a full round trip and the request's weight against the rate limit. The shared request is
forgotten as soon as it settles, so the next call always refetches. Every caller receives the same response object, so
treat it as read-only. An abort signal detaches only its own caller; the shared request is aborted only once every
caller waiting on it has aborted.

## Exchange endpoint

`ExchangeClient` requires a wallet for [signing](signing.md#wallet-compatibility) and works with any transport. See all
[Exchange methods](https://nktkas.gitbook.io/hyperliquid/api-reference/exchange-methods).

<details>
<summary>viem</summary>

```ts
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x...");

const transport = new HttpTransport();
const client = new ExchangeClient({ transport, wallet });

await client.order({ orders: [/* ... */], grouping: "na" });
```

</details>

<details>
<summary>Browser (viem)</summary>

```ts
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { createWalletClient, custom } from "viem";
import { arbitrum } from "viem/chains";

const [account] = await window.ethereum!.request({ method: "eth_requestAccounts" }) as `0x${string}`[];
const wallet = createWalletClient({ account, chain: arbitrum, transport: custom(window.ethereum!) });

const transport = new HttpTransport();
const client = new ExchangeClient({ transport, wallet });

await client.order({ orders: [/* ... */], grouping: "na" });
```

</details>

<details>
<summary>Custom</summary>

Any object matching one of the [supported wallet interfaces](signing.md#wallet-compatibility) works. The minimum
requirement is [`signTypedData`](https://eips.ethereum.org/EIPS/eip-712) and an `address`:

```ts
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import type { AbstractViemLocalAccount } from "@bloxwap/hyperliquid/signing";

const wallet: AbstractViemLocalAccount = {
  address: "0x...",
  async signTypedData({ domain, types, primaryType, message }) {
    // Your EIP-712 signing logic (HSM, MPC, remote signer, etc.)
    return "0x...";
  },
};

const transport = new HttpTransport();
const client = new ExchangeClient({ transport, wallet });

await client.order({ orders: [/* ... */], grouping: "na" });
```

</details>

### Multi-sig

[Multi-signature accounts](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/multi-sig) require multiple
authorized signers to approve every action. The **leader** (first signer in the array) collects all signatures and
submits the final transaction — only the leader's nonce is validated by the server.

```ts
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const multiSigUser = "0x..."; // the multi-sig account address
const signers = [
  privateKeyToAccount("0x..."), // leader — signs the wrapper
  privateKeyToAccount("0x..."),
] as const;

const transport = new HttpTransport();
const client = new ExchangeClient({ transport, signers, multiSigUser });

// Use the client as usual
await client.order({ orders: [/* ... */], grouping: "na" });
```

### Vault and sub-account trading

To trade on behalf of a vault or sub-account, set a default or pass `vaultAddress` per-request. See
[Subaccounts and vaults](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#subaccounts-and-vaults).

```ts
const client = new ExchangeClient({
  transport,
  wallet,
  defaultVaultAddress: "0x...", // is included in every API request that supports this feature
});
```

```ts
await client.order({ orders: [/* ... */], grouping: "na" }, {
  vaultAddress: "0x...", // takes precedence over `defaultVaultAddress`
});
```

### Expiration

A server-side guard. The API rejects the action after this timestamp. See
[Expires After](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#expires-after).

```ts
const client = new ExchangeClient({
  transport,
  wallet,
  defaultExpiresAfter: Date.now() + 60_000, // is included in every API request that supports this feature
});
```

```ts
const client = new ExchangeClient({
  transport,
  wallet,
  defaultExpiresAfter: () => Date.now() + 60_000, // function - recomputed per request
});
```

```ts
await client.order({ orders: [/* ... */], grouping: "na" }, {
  expiresAfter: Date.now() + 60_000, // takes precedence over `defaultExpiresAfter`
});
```

### Signature chain ID

Sets the EIP-712 domain `chainId` for [user-signed actions](signing.md#user-signed-action). Defaults to the wallet's
provider chain ID. Local wallets without a provider (e.g.,
[`privateKeyToAccount`](https://viem.sh/docs/accounts/local/privateKeyToAccount)) fall back to `0x1`. Override to set a
different chain:

```ts
const client = new ExchangeClient({
  transport,
  wallet,
  signatureChainId: "0xa4b1", // static - fixed chain ID
});
```

```ts
const client = new ExchangeClient({
  transport,
  wallet,
  signatureChainId: () => "0xa4b1", // function - recomputed per request
});
```

### Nonce manager

The SDK generates
[nonces](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets#hyperliquid-nonces)
automatically using the `Date.now()` function with auto-increment on duplicates. Replace it if you need custom logic:

```ts
// Custom manager that keeps the built-in monotonic rule, keyed per address
const lastNonceByAddress = new Map<string, number>();

const client = new ExchangeClient({
  transport,
  wallet,
  nonceManager: (address) => {
    const last = lastNonceByAddress.get(address) ?? 0;
    const nonce = Math.max(Date.now(), last + 1); // unique and monotonically increasing
    lastNonceByAddress.set(address, nonce);
    return nonce;
  },
});
```

> [!WARNING]
>
> A custom `nonceManager` MUST return unique, monotonically increasing values per address — a plain
> `(address) => Date.now()` reintroduces same-millisecond collisions, and Hyperliquid only tracks the 100 highest
> nonces per user (rejecting repeats and anything outside that window). When more than one process signs for the same
> wallet, back the manager with shared state (e.g. Redis). See
> [Operational nonce rules](signing.md#operational-nonce-rules).

### Symbol-based orders

Every `ExchangeClient` method that takes a raw asset ID also accepts a `coin` symbol instead — perp name (`"BTC"`),
spot pair (`"HYPE/USDC"`), builder-dex asset (`"dex:ASSET"`), or outcome-market slug. The client resolves symbols to
asset IDs through a [`SymbolConverter`](utilities.md#asset-id--symbolconverter) before signing and dispatch:

```ts
// `coin` instead of the raw `a` index
await client.order({
  orders: [{ coin: "BTC", b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
});

await client.cancel({ cancels: [{ coin: "BTC", o: 12345 }] });
await client.updateLeverage({ coin: "BTC", isCross: true, leverage: 5 });
```

This works on `order`, `modify`, `batchModify`, `cancel`, `cancelByCloid`, `twapOrder`, `twapCancel`,
`updateLeverage`, `updateIsolatedMargin`, and `topUpIsolatedOnlyMargin`. Entries without a `coin` are dispatched
unchanged — no metadata is fetched unless a call actually uses a symbol.

The symbol metadata comes from the client's `symbolConverter` config. When omitted, the client lazily creates and
loads a `SymbolConverter` over the same transport on the first symbol-based call; pass a preloaded instance to enable
builder dexs or to take the metadata fetch off the hot path:

```ts
import { SymbolConverter } from "@bloxwap/hyperliquid/utils";

const converter = await SymbolConverter.create({ transport, dexs: ["test"] });
const client = new ExchangeClient({ transport, wallet, symbolConverter: converter });
```

An unknown symbol rejects with `HyperliquidError` before anything is signed or sent. When both the raw asset ID and
`coin` are set, `coin` wins. The raw functions in `@bloxwap/hyperliquid/api/exchange` take asset IDs only — symbol
resolution is a client-level convenience.

### Friendly names for versioned wire actions

A few methods historically exposed raw upstream wire names. Friendly aliases are now the canonical form; the old
names still work but are deprecated and will be removed in v1.0:

| Deprecated         | Use instead             |
| ------------------ | ----------------------- |
| `withdraw3`        | `withdraw`              |
| `cDeposit`         | `stakingDeposit`        |
| `cWithdraw`        | `stakingWithdraw`       |
| `cSignerAction`    | `validatorSignerAction` |
| `cValidatorAction` | `validatorAction`       |

The aliases exist both on `ExchangeClient` and as raw functions in `@bloxwap/hyperliquid/api/exchange`, and produce
the exact same wire actions as the deprecated names. `agentEnableDexAbstraction` and `userDexAbstraction` are likewise
deprecated in favor of `agentSetAbstraction` and `userSetAbstraction`.

### Pre-signed payloads (sign now, submit later)

`prepareRequest` builds a fully signed request **without sending it**; `submitPrepared` posts it later. A latency-critical
flow (e.g. a tap-trading UI) can pre-sign a cancel-all and fire it with zero signing latency:

```ts
import { order, prepareRequest, submitPrepared } from "@bloxwap/hyperliquid/api/exchange";

// Sign now — nothing is sent yet
const prepared = await client.prepareRequest((config) => order(config, { orders: [/* ... */], grouping: "na" }));

// Submit later, over any transport
await client.submitPrepared(prepared);
```

The callback runs any Exchange method exactly as usual (validation, nonce issuance, signing) against a capture
transport, and must issue exactly one request to the `exchange` endpoint. Exactly-one is enforced — synchronously
recorded, fail-closed at finalize — for every attempt that reaches the capture transport before the callback's
returned promise settles: any invalid attempt arriving within that window — a request to another endpoint or a
second request — fails the whole `prepareRequest` call, even if the callback swallowed the rejection. The returned
payload is the exact wire body (`{ action, signature, nonce, ... }`), works over both `HttpTransport` and
`WebSocketTransport`, and must be submitted through the same network (testnet vs mainnet) it was signed for.

Beyond callback settle, enforcement is **best-effort**:

- An attempt that reaches the capture transport only after the callback settled — a floating (un-awaited) attempt
  fired as the callback returns, whose signing path spans several microtasks past the settle microtask, or leaked
  callback work beginning later (e.g. still awaiting a remote signer) — cannot be caught at prepare time; it
  poisons the payload instead — the attempt's own promise rejects, and `submitPrepared` re-checks the poison flag
  synchronously before posting and rejects a poisoned payload.
- The poison guard is in-process only (a `WeakMap`): serializing and re-parsing a payload silently drops the
  guard.
- `submitPrepared`'s re-check is a point-in-time check, not a happens-before guarantee — an attempt landing after
  the check but before or during the actual post is not caught.
- A leaked attempt whose promise is discarded (`void client.order(...)`) rejects unobserved — an unhandled
  rejection by definition. The rejection is delivered to the attempt's own promise; observing it is the leaker's
  responsibility, not something the SDK can prevent.

> [!WARNING]
>
> The nonce is consumed at **prepare** time. The exchange tracks the 100 highest nonces per user: a prepared payload
> stays valid while its nonce is among them (and within the block-timestamp window) — another request consuming a
> later nonce does NOT invalidate it. The payload goes **stale** only once 100 newer nonces have been consumed.
> Prepare immediately before use anyway.

### Placing many orders at once

An `order` action carries an **array** of orders, and the whole array is covered by **one signature** and costs
**one request**. Fanning the same orders out into N concurrent `order()` calls pays N signatures and N requests for
the same result, and secp256k1 is ~90% of the cost of an order — so this is by a wide margin the largest performance
decision available to a caller.

```ts
// One action, one signature, one request.
await client.order({
  orders: [
    { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } },
    { a: 1, b: false, p: "2000", s: "1.5", r: false, t: { limit: { tif: "Gtc" } } },
    // ... up to the venue's per-action limit
  ],
  grouping: "na",
});
```

Measured on this tree for 100 orders (Bun 1.4.0, Apple M3 Max, zero-latency in-memory transport;
median of 9, so the numbers isolate SDK CPU from the network):

| Approach                                     | Wall time      | Rate-limit weight |
| -------------------------------------------- | -------------- | ----------------- |
| One batched action (either wallet)           | **0.3–0.4 ms** | **3**             |
| 100 concurrent `order()` calls, fast wallet  | 7.2 ms         | 100               |
| 100 concurrent `order()` calls, viem account | 12.1 ms        | 100               |

Batching is ~20–35× less CPU, and it makes the wallet choice stop mattering: one signature
amortized over 100 orders leaves the curve implementation contributing nothing measurable
(0.43 ms fast vs 0.32 ms viem, ranges overlapping). Choosing
[`createFastLocalWallet`](signing.md#fast-local-wallet-wasm-secp256k1) matters most for orders you *cannot* batch.

The weight column is the part that bites first in production: the exchange endpoint charges
`1 + floor(batchLength / 40)`, so 100 orders in one action cost **3** of your
[1200 weight/minute per IP](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits),
while 100 separate actions cost **100**. Batching raises the ceiling on how often you can act by ~33×, independently
of any CPU saving.

> [!NOTE]
>
> `grouping: "na"` is **not** atomic — it is documented as "standard order without grouping", and the orders in the
> array are accepted or rejected individually. You do not need separate actions to avoid all-or-nothing behavior.
> Use `"normalTpsl"` or `"positionTpsl"` only when you actually want the take-profit/stop-loss grouping semantics.

Separate actions are genuinely required only when the orders differ in a field the action carries once rather than
per order — `vaultAddress`, `expiresAfter`, `builder`, or `grouping` itself.

When the orders come from independent callers rather than one place in your code, the
[order batcher](#optional-order-batching) collects them into shared actions for you.

### Orders over WebSocket (low latency)

Every `ExchangeClient` method also works over [`WebSocketTransport`](transports.md#websocket) — the server accepts
signed actions as [WebSocket post requests](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/post-requests),
and the SDK wraps them for you. Each HTTP order pays a TCP/TLS handshake and HTTP framing on top of the round trip;
a WebSocket order is one frame on a connection that is already open, so both latency and — what matters more for
latency-critical apps — its variance drop.

Build and warm everything at app boot, so the first order pays no setup cost:

```ts
import { ExchangeClient, WebSocketTransport } from "@bloxwap/hyperliquid";
import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x...");

const transport = new WebSocketTransport();
await transport.ready(); // finish connecting now, not on the first order

const converter = await SymbolConverter.create({ transport }); // pre-fetch meta (asset IDs, szDecimals)
const client = new ExchangeClient({ transport, wallet, symbolConverter: converter }); // enables `coin` symbols

// Later, on the hot path — one frame out on an open connection:
await client.order({ orders: [{ coin: "BTC", /* ... */ }], grouping: "na" });
```

> [!WARNING]
>
> The server allows at most
> [100 simultaneous in-flight post messages](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)
> across all WebSocket connections per IP (plus 2000 messages/minute overall) — the cap counts concurrent requests, not
> requests per minute, so with typical round trips it sustains far more than the HTTP per-minute budget. An over-limit
> post is rejected and the affected call throws `WebSocketRequestError` ("too many pending post requests"). Leave
> headroom when several clients share the connection or the IP runs several connections.

Two more caveats: explorer requests are HTTP-only, so keep an `HttpTransport` around if you use
[`ExplorerClient`](#explorer-endpoint); and WS requests are bounded by the transport-wide `timeout` — the HTTP-only
[`exchangeTimeout`](transports.md#exchange-timeout) does not apply, though it remains the right bound if you keep an
`HttpTransport` as a fallback order path.

The pattern stacks with pre-signing: sign actions ahead of time with [`signL1Action`](signing.md#l1-actions) and keep
the payload ready, so the hot path carries no signing cost either — the frame goes out the moment the decision is
made.

## WebSocket subscriptions

`SubscriptionClient` requires a [`WebSocketTransport`](transports.md#websocket) — subscriptions can't run over HTTP. See
all [Subscription methods](https://nktkas.gitbook.io/hyperliquid/api-reference/subscription-methods).

```ts
import { SubscriptionClient, WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport();
const client = new SubscriptionClient({ transport });

const subscription = await client.allMids((data) => {
  console.log(data.mids);
});
```

### Errors

Each subscription method takes an optional `options` argument — `{ signal?, onError? }`. The `onError` callback runs at
most once per subscribe call, when an already confirmed subscription fails:

- the server rejects a re-subscription after a [reconnect](transports.md#reconnection);
- the connection is permanently terminated;
- the connection goes down while [re-subscription](transports.md#resubscription) is disabled.

When several calls share one underlying subscription (see [unsubscribe](#unsubscribe)), every caller's `onError` fires.
Failures before confirmation reject the subscribe promise instead. After `onError` fires, the subscription is removed
and no further events arrive:

```ts
const subscription = await client.allMids(
  (data) => {
    console.log(data.mids);
  },
  {
    onError: (error: TransportError) => {
      // The subscription is gone — inspect the error and re-subscribe if needed
      console.error(error);
    },
  },
);
```

The same failure is also exposed on the subscription handle as `failureSignal` — an `AbortSignal` that aborts with the
failure `TransportError` as its reason, and never on a voluntary `unsubscribe()`. It makes a dead feed observable even
when no `onError` was passed. Every handle returned by a `SubscriptionClient` method carries one (the
`ClientSubscription` type): if the transport does not provide a signal — the field is optional on the transport-level
`ISubscription` interface so third-party transports stay valid — the client synthesizes one from the `onError`
contract:

```ts
const subscription = await client.allMids((data) => {
  console.log(data.mids);
});

subscription.failureSignal.addEventListener("abort", () => {
  // The subscription is gone — inspect the reason and re-subscribe if needed
  console.error(subscription.failureSignal.reason);
});
```

### Unsubscribe

Hyperliquid allows
[1000 active subscriptions and 14 unique users](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)
**per IP address** — not per connection, so every `WebSocketTransport` on a network shares one budget (see
[WebSocket limits](transports.md#websocket-limits)). The official docs say 10 unique users and the server's own
refusal says 15; a live mainnet probe on 2026-08-02 measured the enforced ceiling at 14 on two independent
connections, which is what the SDK guards against — see [known drift](reference/known-drift.md).
Call `unsubscribe()` to remove a listener and free these slots:

```ts
const subscription = await client.allMids((data) => {
  console.log(data.mids);
});

// Later
await subscription.unsubscribe();
```

Subscribing to the same channel multiple times reuses one underlying subscription. Each `unsubscribe()` removes only its
listener — the channel stays open until the last one is removed:

```ts
const sub1 = await client.allMids((data) => console.log("A:", data.mids));
const sub2 = await client.allMids((data) => console.log("B:", data.mids));

await sub1.unsubscribe(); // removes listener A, subscription stays active
await sub2.unsubscribe(); // removes listener B, channel closed
```

To tear down everything at once, `unsubscribeAll()` unsubscribes every subscription opened through a
`SubscriptionClient` on the same transport, concurrently, and clears the registry:

```ts
import { unsubscribeAll } from "@bloxwap/hyperliquid/api/subscription";

await client.unsubscribeAll();
// or, with the standalone function on the same transport:
await unsubscribeAll({ transport });
```

Subscriptions already unsubscribed or failed are not revisited. A subscribe call still waiting for its confirmation
resolves with an already-unsubscribed handle once the confirmation lands — it never joins the registry, and
`unsubscribeAll()` does not wait for it. The scope is the transport: two clients sharing one transport share the
registry, while subscriptions opened through `transport.subscribe()` directly are not tracked. The connection itself
stays open — call `transport.close()` when done with it.

### Stability contract for server-extensible events

Hyperliquid extends its API server-side without notice: new event variants, new ledger entry types, new enum values.
This SDK never validates incoming WebSocket frames or REST responses against a schema, so such a change can never
throw at runtime or corrupt neighboring data — at worst, a value arrives that the current type definitions do not
name yet.

How each kind of union is typed against that:

- **`UserEventsEvent`** (the `userEvents` subscription) is treated as **server-extensible**. The union ends in an
  opaque `UnknownUserEvent` catch-all, so a variant added server-side before this SDK names it still type-checks and
  reaches your listener with its raw payload untouched. The catch-all is deliberately opaque: an index signature
  would merge into every `"fills" in event` narrowing and erase the known variants' types. Known variants keep full
  narrowing; the catch-all only surfaces in the final `else`:

  ```ts
  const sub = await client.userEvents({ user: "0x..." }, (event) => {
    if ("fills" in event) {
      event.fills; // UserFillsResponse — fully narrowed
    } else if ("funding" in event) {
      event.funding; // fully narrowed
    } else {
      // event: UnknownUserEvent — a variant this SDK version does not know.
      // Inspect the raw payload with Object.entries(event) or a cast.
    }
  });
  ```

- **Value-discriminated unions stay strict**: the ledger `delta` union (`userNonFundingLedgerUpdates`), the TWAP
  `status` union (`twapHistory` / `userTwapHistory`), and the `OrderProcessingStatus` enum (`historicalOrders`,
  `orderUpdates`) are closed unions. TypeScript cannot admit a catch-all member into a `delta.type === "deposit"`-style
  narrowing without degrading every known variant's fields to `unknown`, so these types trade forward-compatibility
  for precise narrowing. Because nothing is validated at runtime, a new server-side variant simply arrives untyped —
  keep a `default` branch in `switch` statements over them and upgrade the SDK to pick up new members.

## Explorer endpoint

`ExplorerClient` reads the Hyperliquid blockchain [explorer](https://app.hyperliquid.xyz/explorer), which lives on the
RPC endpoint. See all [Explorer methods](https://nktkas.gitbook.io/hyperliquid/api-reference/explorer-methods).

Requests take an `HttpTransport`:

```ts
import { ExplorerClient, HttpTransport } from "@bloxwap/hyperliquid";

const transport = new HttpTransport();
const client = new ExplorerClient({ transport });

const block = await client.blockDetails({ height: 123 });
```

Subscriptions take a [`WebSocketTransport`](transports.md#websocket) pointed at the RPC WebSocket URL:

```ts
import { ExplorerClient, WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport({ url: "wss://rpc.hyperliquid.xyz/ws" });
const client = new ExplorerClient({ transport });

const sub = await client.explorerBlock((data) => {
  console.log(data);
});
```

To query and subscribe from one client, pass separate transports instead — each method uses the transport built for
it:

```ts
import { ExplorerClient, HttpTransport, WebSocketTransport } from "@bloxwap/hyperliquid";

const client = new ExplorerClient({
  requestTransport: new HttpTransport(),
  subscriptionTransport: new WebSocketTransport({ url: "wss://rpc.hyperliquid.xyz/ws" }),
});

const block = await client.blockDetails({ height: 123 });
const sub = await client.explorerBlock((data) => {
  console.log(data);
});
```

Request methods (`blockDetails`, `txDetails`, `userDetails`) require a request-capable transport and subscription
methods (`explorerBlock`, `explorerTxs`) a subscription-capable one — with either config shape, calling a method whose
transport was not provided is a compile-time error.

## Common options

### Cancellation

Request methods of [`InfoClient`](#info-endpoint) and [`ExplorerClient`](#explorer-endpoint) accept an optional
[`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) as the last argument:

```ts
const controller = new AbortController();
const mids = await client.allMids(controller.signal);
```

---

[`ExchangeClient`](#exchange-endpoint) methods accept it inside the options object (last argument):

```ts
const controller = new AbortController();
await client.order({ orders: [/* ... */], grouping: "na" }, {
  signal: controller.signal,
});
```

Unlike [`Expiration`](#expiration), which is a server-side guard, cancellation aborts the request on the client side
before or during delivery.

### Skipping validation (unsafe)

Every [`ExchangeClient`](#exchange-endpoint) call validates and normalizes its parameters before signing (a valibot
parse + key canonicalization pass, ~1 µs). Trusted, performance-critical callers can opt out per request with
`skipValidation`:

```ts
await client.order({ orders: [/* ... */], grouping: "na" }, {
  skipValidation: true,
});
```

> [!CAUTION]
>
> **Unsafe for untrusted input.** On this path the SDK performs no validation, normalization, default-filling, or key
> reordering — parameters are signed and posted exactly as given, so they must already be in canonical wire form:
>
> - object keys in schema-declared order (the signature commits to the encoded key order);
> - decimals as normalized strings (e.g. `"30000"`, not `3e4` or `"030000"`);
> - addresses and hex strings in lowercase;
> - every schema field with a default (e.g. `grouping: "na"`) provided explicitly.
>
> Invalid input is the caller's problem: instead of a client-side `ValidationError`, the server rejects the request —
> detecting that drift is the cost of the saved microseconds. Cheap deterministic guards for documented constraints
> (e.g. `scheduleCancel`'s 5-second lead time) still run.

### Shared fast price decoding

`fastAssetCtxs` decodes each compressed frame once per transport, then delivers it to that transport's
local subscribers in arrival order. Each callback receives its own mutable asset map and price records,
so changes made by one subscriber do not affect another. Unsubscribing or aborting suppresses queued deliveries;
listeners added later do not receive previously queued frames. A corrupt frame or throwing callback does not end
other listeners or stop subsequent updates. Separate transports keep separate decode queues.

## Canonical actions and explicit execution

Build an action once when its fields are stable, then choose when to sign and submit it:

```ts
import { ExchangeClient } from "@bloxwap/hyperliquid/api/exchange/client";
import { HttpTransport } from "@bloxwap/hyperliquid/transport/http";
import { buildOrder } from "@bloxwap/hyperliquid/actions/order";
import { privateKeyToAccount } from "viem/accounts";

const exchange = new ExchangeClient({
  transport: new HttpTransport(),
  wallet: privateKeyToAccount(process.env.HL_PRIVATE_KEY as `0x${string}`),
});
const action = buildOrder({
  orders: [{ a: 0, b: true, p: "30000", s: "0.01", r: false, t: { limit: { tif: "Gtc" } } }],
});
const signed = await exchange.sign(action);
const result = await exchange.submit(signed);
// Or sign and submit in one coordinated call:
await exchange.execute(action);
```

Builders validate, normalize, fill defaults, and copy/freeze nested fields. They allocate no nonce and perform no
wallet or transport calls. The input remains owned by the caller. Reuse a built action while its fields remain valid;
resolve coin symbols to asset IDs before building. Time-dependent constraints such as scheduled cancellation are
checked when building, so rebuild those actions before reuse.
An explicit `buildNoop({ nonce })` retains that nonce rather than allocating a fresh one on reuse.
Reuse is where the speedup comes from: a reused L1 action skips validation, copying, and MessagePack encoding on every
signature. Building a fresh action for each call costs slightly more than the raw method, because the builder also
copies and freezes its input, so keep using raw methods for one-off actions.

Signing consumes one nonce and produces an immutable signed request. Submission preserves the operation's response
type and does not sign again. Submit promptly: expiration, the protocol timestamp range, and the signer's 100-highest
nonce window still apply. Signed ownership and network checks are in-process; serialize for storage only if you intend
to use the legacy `submitPrepared` wire-payload API. Reconstructed canonical actions must be rebuilt through a builder.

Each stage accepts a `signal`. Aborting before signing starts consumes no nonce. Aborting while the wallet signs
rejects the call without posting anything; the allocated nonce is skipped, which the exchange tolerates as a gap. A
signed request does not hold on to the signal it was signed with: to cancel it, drop it and let its nonce go stale.
Aborting `submit` (or `execute` after signing) stops waiting for the response, but it cannot recall a request that has
already been sent, so the exchange may still apply it. Resubmitting the same signed request is safe, because the
exchange rejects a nonce it has already seen and the action cannot be applied twice.

The standalone `signAction`, `submitAction`, and `executeAction` functions in
`@bloxwap/hyperliquid/actions/execution` accept the same exchange config. Existing client methods and
`prepareRequest` / `submitPrepared` continue to work.

## Optional order batching

Independent callers that each place one order can share signatures and requests through an opt-in batcher. Each
caller still gets its own result:

```ts
import { createOrderBatcher } from "@bloxwap/hyperliquid/actions/orderBatcher";

const batcher = createOrderBatcher(exchange.config, {
  maxQueueSize: 1000, // queued plus in-flight orders
  maxBatchSize: 100, // orders per request
  flushIntervalMs: 1, // longest wait for a partial batch
});
const outcome = await batcher.enqueue({
  a: 0, b: true, p: "30000", s: "0.01", r: false, t: { limit: { tif: "Gtc" } },
});
if (typeof outcome === "object" && "error" in outcome) console.error(outcome.error);
await batcher.close();
```

Queued orders are sent when a batch reaches `maxBatchSize` (which flushes the whole queue), when `flushIntervalMs`
elapses, or when you call `flush()`. Each request carries one action, one signature, and one nonce, through the same
signing path as `exchange.execute`, so nonce management, the dispatch policy, and the transport's rate limiting
apply unchanged. `exchange.order()` and the other existing methods still dispatch immediately and keep their error
behavior.

Only orders that agree on everything the action or request carries once share a batch: `grouping`, `builder`,
`vaultAddress`, and `expiresAfter`. ALO orders are also kept apart from IOC and GTC orders so they keep their
prioritization, and under priority grouping (`{ p }`), where the exchange requires every order in the action to be IOC
or every order to be a non-reduce-only ALO, orders are further split by time-in-force and reduce-only flag. The batcher
is bound to one config, so signer and network never mix.

`grouping` accepts `"na"` (the default) or `{ p }`. The TP/SL groupings (`normalTpsl`, `positionTpsl`) link the orders
of one action, so a stop-loss from one caller could become the child of another caller's entry order. `enqueue`
rejects them; send a TP/SL group as one `exchange.order()` call instead.

Results:

- `enqueue` resolves with the server's status for that order, in the order it was submitted: `resting`, `filled`,
  `waitingForFill`, `waitingForTrigger`, or `{ error }`. An error status for one order does not affect the others in
  its batch; unlike `exchange.order()`, mixed responses are never turned into a rejection.
- A whole-batch failure rejects every caller in that batch: a top-level `status: "err"`, a response whose statuses do
  not match the submitted orders one to one, or a transport failure.
- An invalid order rejects only its own `enqueue`, before it is queued.
- A full queue rejects `enqueue` immediately with `Order batcher queue is full`.
- An order whose `expiresAfter` has passed before its batch is sent rejects without being sent.

Cancellation and shutdown:

- Aborting an `enqueue` signal before its batch is sent removes the order; nothing is sent for it.
- Aborting after the batch is sent only stops that caller waiting. It does not cancel the order, which the exchange may
  already have accepted, and its slot counts against `maxQueueSize` until the batch settles.
- `flush()` sends everything queued and waits for every batch in flight.
- `close()` stops new enqueues and drains: queued orders are sent and their callers settle normally.
- `close({ drain: false })` rejects every waiting caller and stops waiting for in-flight batches. Orders already sent
  may still be accepted; the rejection does not mean they were cancelled.
- The batcher never retries a batch. A failure after sending is ambiguous (the exchange may have applied the action),
  so reconcile with open orders or fills before placing the orders again.

Rate limits: each request costs `1 + floor(orders / 40)` of the per-IP REST weight, so 100 orders in one batch cost 3
instead of 100. Address-based limits still count every order individually; batching does not raise them.

Batching trades latency for throughput. It helps when many orders arrive together, and costs a timer hop when they
arrive one at a time. Measured with 300 single-order callers, real secp256k1 signing, and a 5 ms mock transport
(`bun .dev/perf/order_batching.ts`, Bun 1.4.0, Apple M3 Max, median of 5 rounds):

| Callers arrive      | Mode                  | Orders/s | p50 / p99 latency | Signatures and requests | Weight |
| ------------------- | --------------------- | -------- | ----------------- | ----------------------- | ------ |
| All at once         | `order()` per caller  | ~3,800   | 74 / 76 ms        | 300                     | 300    |
| All at once         | batch 5, flush 1 ms   | ~16,000  | 13 / 18 ms        | 60                      | 60     |
| All at once         | batch 100, flush 0 ms | ~43,000  | 6 / 7 ms          | 3                       | 9      |
| One per millisecond | `order()` per caller  | ~900     | 5.1 / 6.5 ms      | 300                     | 300    |
| One per millisecond | batch 100, flush 1 ms | ~680     | 6.5 / 9.2 ms      | 300                     | 300    |
| One per millisecond | batch 100, flush 5 ms | ~680     | 9.1 / 12.3 ms     | 75                      | 75     |

With steady arrivals, a flush interval shorter than the gap between orders sends batches of one and only adds delay;
a longer one batches more but makes every caller wait for it. Measure with your own traffic before choosing values.

## Bounded dispatch for remote signing

By default the SDK signs concurrently but sends a signer's requests in nonce-issuance order, so one slow remote
signature delays every later request for that signer and network. The exchange does not require that order: it accepts
any unused nonce above the smallest of the signer's 100 highest nonces. A dedicated signer can opt into bounded
dispatch, which sends ready signatures ahead of a slower earlier one:

```ts
const exchange = new ExchangeClient({
  transport,
  wallet,
  dispatchPolicy: { mode: "bounded", maxOvertakes: 99, maxPending: 1000 },
});
```

- `maxOvertakes` (0–99, default 99) caps how many newer requests may be sent while an earlier one is still
  outstanding. The count is cumulative until the earlier request's response settles, so newer requests that finish
  quickly cannot keep overtaking it and push its nonce out of the exchange's window, even if requests arrive in a
  different order than they were sent. Among signed requests waiting for the window, the oldest goes first. `0`
  reproduces ordered dispatch.
- `maxPending` (default 1000) caps signing, waiting, and in-flight requests. A call beyond it rejects with
  `Bounded dispatch queue is full` without consuming a nonce.
- Before sending, a request that waited is checked again against the protocol timestamp window (its nonce must be
  within two days before and one day after the current time) and its `expiresAfter`. A failed check rejects the call
  without sending it.
- A wallet rejection, an abort, an expiry, or a transport failure (including a closed WebSocket) settles the call and
  frees its slot; the skipped nonce is a gap the exchange tolerates. A signature that completes after its call was
  aborted is never sent. A signature that never completes holds back further overtaking until it is aborted, so pass a
  `signal` with a deadline when the signer can stall.
- WebSocket and HTTP transport limits are unchanged and apply separately from the nonce bound: `post` frames are
  still charged to the shared WebSocket message budget without waiting for it.

Bounded dispatch pays off when requests arrive steadily and some signatures are much slower than others: ready
requests no longer queue behind a slow one. It is not a throughput setting. A burst much larger than `maxOvertakes`
can finish later than under ordered dispatch, because ordered dispatch assumes requests arrive in the order they were
sent and keeps all of them in flight, while bounded dispatch counts each in-flight request against the window until
its response returns. Measure with your own signer and traffic before switching.

The coordinator is shared per signer address and network across every `ExchangeClient` and standalone function in
the process, HTTP and WebSocket alike, and so is the default nonce source. Multi-sig requests are coordinated by the
leader signer, the same key their nonces are issued under; vault and sub-account requests share their signer's lane.

Bounded mode supports managed calls only: ordinary exchange methods, `exchange.execute`, and `executeAction`.
`exchange.sign` / `exchange.submit`, `signAction` / `submitAction`, `prepareRequest`, and `submitPrepared` reject in
bounded mode, and also reject while bounded calls for that signer and network are outstanding, because a detached
submission's nonce would escape the bound. Ordered and bounded calls, or bounded calls with different limits, cannot be
active for the same signer and network at the same time.

The coordinator only sees requests made through this process. Other processes, other SDK instances bundled separately,
direct `transport.request` calls, and anything that submits for the same signer elsewhere also consume nonces in its
100-highest window, and the bound cannot account for them. Use bounded dispatch only with a signer (typically an API
wallet) dedicated to this process.
