# @bloxwap/hyperliquid documentation

`@bloxwap/hyperliquid` is a community-supported Hyperliquid API SDK for TypeScript and JavaScript runtimes.

Use the [table of contents](SUMMARY.md) to browse every guide, or start with:

- [Connect to Hyperliquid](transports.md)
- [Clients](clients.md)
- [Error handling](error-handling.md)
- [Utilities](utilities.md)
- [Signing](signing.md)

## Installation

### Bun 1.3.3+

```sh
bun add @bloxwap/hyperliquid
```

### Node.js 22.12+

```sh
npm i @bloxwap/hyperliquid
```

### pnpm

```sh
pnpm add @bloxwap/hyperliquid
```

### Yarn

```sh
yarn add @bloxwap/hyperliquid
```

### React Native 0.86+

```sh
npm i @bloxwap/hyperliquid
```

The `fastAssetCtxs` subscription additionally needs `DecompressionStream`, Web Streams, and `TextDecoder`, none of which
Hermes provides:

```sh
npm i text-encoding-polyfill web-streams-polyfill compression-streams-polyfill
```

```ts
import "text-encoding-polyfill";
import "web-streams-polyfill/polyfill";
import "compression-streams-polyfill";
```

On **React Native < 0.86**, the global `Event` and `EventTarget` are missing:

```sh
npm i event-target-shim
```

```ts
import { Event, EventTarget } from "event-target-shim";

if (!globalThis.EventTarget) globalThis.EventTarget = EventTarget;
if (!globalThis.Event) globalThis.Event = Event;
```

On **React Native < 0.84**, the native `URL` is incomplete:

```sh
npm i react-native-url-polyfill
```

```ts
import "react-native-url-polyfill/auto";
```

Import every polyfill before `@bloxwap/hyperliquid`, such as at the top of `index.js`.

## Quick start

### Read market data

Use `InfoClient` to read market data, account state, and order books. See the [Info endpoint](clients.md#info-endpoint)
for all client behavior.

```ts
import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";

const transport = new HttpTransport();
const client = new InfoClient({ transport });

const mids = await client.allMids();
```

### Trade

Use `ExchangeClient` to place orders, transfer funds, and manage accounts. See the
[Exchange endpoint](clients.md#exchange-endpoint) before using a funded wallet.

```ts
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x...");
const transport = new HttpTransport();
const client = new ExchangeClient({ transport, wallet });

await client.order({
  orders: [{
    a: 0,
    b: true,
    p: "50000",
    s: "0.01",
    r: false,
    t: { limit: { tif: "Gtc" } },
  }],
  grouping: "na",
});
```

### Subscribe

Use `SubscriptionClient` to receive real-time updates. See
[WebSocket subscriptions](clients.md#websocket-subscriptions) for subscription lifecycle details.

```ts
import { SubscriptionClient, WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport();
const client = new SubscriptionClient({ transport });

await client.allMids((data) => {
  console.log(data.mids);
});
```

### Explore

Use `ExplorerClient` to look up blocks, transactions, and addresses. See the
[Explorer endpoint](clients.md#explorer-endpoint) for the available methods.

```ts
import { ExplorerClient, HttpTransport } from "@bloxwap/hyperliquid";

const transport = new HttpTransport();
const client = new ExplorerClient({ transport });

const block = await client.blockDetails({ height: 123 });
```

## Versioning

This SDK follows [Semantic Versioning](https://semver.org/). Until `1.0.0`, breaking changes bump the minor version and
everything else bumps the patch, following the
[caret-range convention](https://github.com/npm/node-semver#caret-ranges-123-025-004).

The exception is request, response, and event types that mirror the Hyperliquid API. The API is unversioned and always
serves its latest shape, so changes to these types ship in patch releases even when breaking: the break comes from
Hyperliquid, not the SDK.

For places where the official Hyperliquid documentation and the live API currently disagree, see
[Known documentation drift](reference/known-drift.md).
