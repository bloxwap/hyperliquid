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

## Exchange endpoint

`ExchangeClient` requires a wallet for [signing](signing.md#wallet-compatibility) and works with any transport. See all
[Exchange methods](https://nktkas.gitbook.io/hyperliquid/api-reference/exchange-methods).

{% tabs %}

{% tab title="viem" %}

```ts
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x...");

const transport = new HttpTransport();
const client = new ExchangeClient({ transport, wallet });

await client.order({ orders: [/* ... */], grouping: "na" });
```

{% endtab %}

{% tab title="Browser (viem)" %}

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

{% endtab %}

{% tab title="Custom" %}

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

{% endtab %}

{% endtabs %}

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

{% hint style="warning" %}

A custom `nonceManager` MUST return unique, monotonically increasing values per address — a plain
`(address) => Date.now()` reintroduces same-millisecond collisions, and Hyperliquid only tracks the 100 highest
nonces per user (rejecting repeats and anything outside that window). When more than one process signs for the same
wallet, back the manager with shared state (e.g. Redis). See
[Operational nonce rules](signing.md#operational-nonce-rules).

{% endhint %}

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

{% hint style="warning" %}

The nonce is consumed at **prepare** time. The exchange tracks the 100 highest nonces per user: a prepared payload
stays valid while its nonce is among them (and within the block-timestamp window) — another request consuming a
later nonce does NOT invalidate it. The payload goes **stale** only once 100 newer nonces have been consumed.
Prepare immediately before use anyway.

{% endhint %}

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
const client = new ExchangeClient({ transport, wallet });

// Later, on the hot path — one frame out on an open connection:
await client.order({ orders: [/* ... */], grouping: "na" });
```

{% hint style="warning" %}

The server allows at most
[100 simultaneous in-flight post messages](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)
across all WebSocket connections per IP (plus 2000 messages/minute overall) — the cap counts concurrent requests, not
requests per minute, so with typical round trips it sustains far more than the HTTP per-minute budget. An over-limit
post is rejected and the affected call throws `WebSocketRequestError` ("too many pending post requests"). Leave
headroom when several clients share the connection or the IP runs several connections.

{% endhint %}

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
most once, when an already confirmed subscription fails:

- the server rejects a re-subscription after a [reconnect](transports.md#reconnection);
- the connection is permanently terminated;
- the connection goes down while [re-subscription](transports.md#resubscription) is disabled.

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

### Unsubscribe

A single connection supports up to
[1000 active subscriptions and 10 unique users](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).
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

{% hint style="danger" %}

**Unsafe for untrusted input.** On this path the SDK performs no validation, normalization, default-filling, or key
reordering — parameters are signed and posted exactly as given, so they must already be in canonical wire form:

- object keys in schema-declared order (the signature commits to the encoded key order);
- decimals as normalized strings (e.g. `"30000"`, not `3e4` or `"030000"`);
- addresses and hex strings in lowercase;
- every schema field with a default (e.g. `grouping: "na"`) provided explicitly.

Invalid input is the caller's problem: instead of a client-side `ValidationError`, the server rejects the request —
detecting that drift is the cost of the saved microseconds. Cheap deterministic guards for documented constraints
(e.g. `scheduleCancel`'s 5-second lead time) still run.

{% endhint %}
