---
title: Tree-shaking
description: Use narrow entry points and direct method imports to reduce SDK bundle size and startup work.
---

# Tree-shaking

The SDK is organized into modular entry points so bundlers can eliminate unused code.

## Entry points

| Entry point                                     | Contains                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@bloxwap/hyperliquid`                          | [Transports](../transports.md), [clients](../clients.md), [error classes](../error-handling.md)                           |
| [`@bloxwap/hyperliquid/signing`](../signing.md) | Signing functions, wallet utilities                                                                                       |
| [`@bloxwap/hyperliquid/utils`](../utilities.md) | `formatPrice`, `formatSize`, `SymbolConverter`                                                                            |
| `@bloxwap/hyperliquid/api/info`                 | [Info methods](https://nktkas.gitbook.io/hyperliquid/api-reference/info-methods), individually importable                 |
| `@bloxwap/hyperliquid/api/exchange`             | [Exchange methods](https://nktkas.gitbook.io/hyperliquid/api-reference/exchange-methods), individually importable         |
| `@bloxwap/hyperliquid/api/subscription`         | [Subscription methods](https://nktkas.gitbook.io/hyperliquid/api-reference/subscription-methods), individually importable |
| `@bloxwap/hyperliquid/api/explorer`             | [Explorer methods](https://nktkas.gitbook.io/hyperliquid/api-reference/explorer-methods), individually importable         |

Each entry point has independent dependencies — e.g., importing `@bloxwap/hyperliquid/utils` doesn't pull in signing or
validation code.

## Direct method imports

Instead of creating a [client](../clients.md), import individual methods directly: each import pulls in only that
method, its validation schema, and the transport logic — not the full client with all its methods.

Each method accepts the same config as its client as the first argument:

Info methods use [`InfoClient`](../clients.md#info-endpoint) config:

```ts
import { HttpTransport } from "@bloxwap/hyperliquid/transport/http";
import { allMids } from "@bloxwap/hyperliquid/api/info/allMids";

const transport = new HttpTransport();
const result = await allMids({ transport });
```

Exchange methods use [`ExchangeClient`](../clients.md#exchange-endpoint) config:

```ts
import { HttpTransport } from "@bloxwap/hyperliquid/transport/http";
import { order } from "@bloxwap/hyperliquid/api/exchange/order";
import { privateKeyToAccount } from "viem/accounts";

const transport = new HttpTransport();
const wallet = privateKeyToAccount("0x...");

await order(
  { transport, wallet },
  {
    orders: [{
      a: 0,
      b: true,
      p: "50000",
      s: "0.01",
      r: false,
      t: { limit: { tif: "Gtc" } },
    }],
    grouping: "na",
  },
);
```

Subscription methods use [`SubscriptionClient`](../clients.md#websocket-subscriptions) config:

```ts
import { WebSocketTransport } from "@bloxwap/hyperliquid/transport/websocket";
import { allMids } from "@bloxwap/hyperliquid/api/subscription/allMids";

const transport = new WebSocketTransport();
const subscription = await allMids({ transport }, (data) => {
  console.log(data.mids);
});
```

Explorer methods use [`ExplorerClient`](../clients.md#explorer-endpoint) config:

```ts
import { HttpTransport } from "@bloxwap/hyperliquid/transport/http";
import { blockDetails } from "@bloxwap/hyperliquid/api/explorer/blockDetails";

const transport = new HttpTransport();
const block = await blockDetails({ transport }, { height: 123 });
```

## One-operation entry points

Every public method is available at `@bloxwap/hyperliquid/api/<family>/<method>`, including its parameter and response
types. The four families are `info`, `exchange`, `explorer`, and `subscription`. Existing API barrels and client paths
remain available. Per-operation imports reduce runtime module evaluation even when Node or Bun runs without a bundler;
API barrel imports rely on bundling/tree-shaking to remove sibling operations.

```ts
import type { L2BookParameters, L2BookResponse } from "@bloxwap/hyperliquid/api/info/l2Book";
import { l2Book } from "@bloxwap/hyperliquid/api/info/l2Book";
```

Canonical builders are available at `@bloxwap/hyperliquid/actions/<method>` (for example `buildOrder` from
`actions/order`). Import execution stages separately from `actions/execution` when you need only a few builders.
The `actions` barrel contains every builder and the optional order batcher.

Underscore-prefixed paths such as `api/info/_base` are private and are not exported; everything a caller needs is
reachable through the paths above.

## Choosing an import style

| Import                                                | Use it when                                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client (`api/<family>/client`, or the root barrel)    | You call many methods of a family, want one object that holds the config, or prefer discoverability over size. Loads every method it wraps.          |
| API barrel (`api/<family>`)                           | You bundle for the browser and want several functions from one import line. A bundler removes unused siblings; unbundled Node and Bun load them all. |
| One operation (`api/<family>/<method>`)               | A script, server function or CLI runs without a bundler and calls a few methods. Only that method, its schema and shared core code load.             |
| Builder (`actions/<method>`) with `actions/execution` | You build, sign and submit exchange actions as separate steps, for example to sign remotely or batch.                                                |

The narrow paths matter most for cold starts. Importing only Info `allMids` loads no signing, Exchange, or Subscription
code, and an Exchange operation loads the signing core but none of its sibling actions. Checks in the SDK build keep
these closures within fixed module budgets.
