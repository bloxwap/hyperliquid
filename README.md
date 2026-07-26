<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/hyperliquid-light.svg">
    <img alt="Hyperliquid" src="./.github/hyperliquid-dark.svg" height="50">
  </picture>
  <br>
  <strong>Blazing fast typescript
    <a href="https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api">Hyperliquid SDK</a></strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bloxwap/hyperliquid"><img alt="npm version" src="https://img.shields.io/npm/v/@bloxwap/hyperliquid?color=blue"></a>
  <a href="https://www.npmjs.com/package/@bloxwap/hyperliquid"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@bloxwap/hyperliquid.svg"></a>
  <a href="https://coveralls.io/github/bloxwap/hyperliquid?branch=main"><img alt="Coverage status" src="https://coveralls.io/repos/github/bloxwap/hyperliquid/badge.svg?branch=main"></a>
  <a href="https://bundlephobia.com/package/@bloxwap/hyperliquid"><img alt="Bundle size" src="https://img.shields.io/bundlephobia/minzip/@bloxwap/hyperliquid"></a>
</p>

## Features

- **Typed**: Source code is 100% TypeScript.
- **Tested**: Good code coverage and type relevance.
- **Minimal dependencies**: A few small trusted dependencies.
- **Cross-Environment Support**: Compatible with all major JS runtimes.
- **Integratable**: Easy to use with [viem](https://github.com/wevm/viem) accounts — local (private key) or JSON-RPC
  (browser wallet).

## Installation

**Bun 1.3.3+**

```sh
bun add @bloxwap/hyperliquid
```

**Node.js 22.12+ / React Native 0.86+**

```sh
npm i @bloxwap/hyperliquid
```

**pnpm**

```sh
pnpm add @bloxwap/hyperliquid
```

**Yarn**

```sh
yarn add @bloxwap/hyperliquid
```

> React Native needs polyfills for the `fastAssetCtxs` subscription and for versions below 0.86 — see the
> [documentation](https://nktkas.gitbook.io/hyperliquid).

## Quick Example

### Read data

```ts
// 1. Import module
import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";

// 2. Set up client with transport
const transport = new HttpTransport();
const info = new InfoClient({ transport });

// 3. Query data

// Retrieve mids for all coins
const mids = await info.allMids();

// Retrieve a user's open orders
const openOrders = await info.openOrders({ user: "0x..." });

// L2 book snapshot
const book = await info.l2Book({ coin: "BTC" });
```

### Trading

```ts
// 1. Import modules
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

// 2. Set up client with wallet and transport
const wallet = privateKeyToAccount("0x...");

const transport = new HttpTransport();
const exchange = new ExchangeClient({ transport, wallet });

// 3. Execute an action

// Place an order
const result = await exchange.order({
  orders: [{
    a: 0,
    b: true,
    p: "95000",
    s: "0.01",
    r: false,
    t: { limit: { tif: "Gtc" } },
  }],
  grouping: "na",
});

// Update leverage
await exchange.updateLeverage({ asset: 0, isCross: true, leverage: 5 });

// Initiate a withdrawal request
await exchange.withdraw3({ destination: "0x...", amount: "1" });
```

### Real-time updates

```ts
// 1. Import module
import { SubscriptionClient, WebSocketTransport } from "@bloxwap/hyperliquid";

// 2. Set up client with transport
const transport = new WebSocketTransport();
const subs = new SubscriptionClient({ transport });

// 3. Subscribe to events

// Subscribe to mids for all coins
await subs.allMids((data) => {
  console.log(data);
});

// Subscribe to user's open orders
await subs.openOrders({ user: "0x..." }, (data) => {
  console.log(data);
});

// Subscribe to L2 book snapshot
await subs.l2Book({ coin: "ETH" }, (data) => {
  console.log(data);
});
```

> [!WARNING]
> - **Never hardcode private keys** in source or commit them to git. Load them from environment variables or a secret
>   store (Bun auto-loads a local `.env`, which is gitignored in this repo).
> - For trading bots, prefer a Hyperliquid **agent wallet** (API wallet) over the master account key: an agent key can
>   trade but cannot withdraw, and it can be revoked without rotating the master key.
> - See [Signing](docs/signing.md) for how wallets, signatures, and nonces work.

## Documentation

Full guides, examples, and API reference: [nktkas.gitbook.io/hyperliquid](https://nktkas.gitbook.io/hyperliquid)
