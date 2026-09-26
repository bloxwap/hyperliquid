<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/bloxwap/hyperliquid/main/.github/hyperliquid-light.svg">
    <img alt="Hyperliquid" src="https://raw.githubusercontent.com/bloxwap/hyperliquid/main/.github/hyperliquid-dark.svg" height="50">
  </picture>
  <br>
  <strong>Blazing fast typescript
    <a href="https://bloxwap.github.io/hyperliquid/docs/">Hyperliquid SDK</a></strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bloxwap/hyperliquid"><img alt="npm version" src="https://img.shields.io/npm/v/@bloxwap/hyperliquid?color=blue&style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@bloxwap/hyperliquid"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@bloxwap/hyperliquid.svg?style=flat-square"></a>
  <a href="https://codecov.io/gh/bloxwap/hyperliquid"><img alt="Codecov coverage" src="https://img.shields.io/codecov/c/github/bloxwap/hyperliquid?branch=main&style=flat-square"></a>
  <a href="https://bundlejs.com/?q=@bloxwap/hyperliquid&amp;config=%7B%22esbuild%22%3A%7B%22external%22%3A%5B%22viem%22%2C%22tiny-secp256k1%22%2C%22hash-wasm%22%5D%7D%7D"><img alt="Bundle size" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdeno.bundlejs.com%2F%3Fq%3D%40bloxwap%2Fhyperliquid%26config%3D%257B%2522esbuild%2522%253A%257B%2522external%2522%253A%255B%2522viem%2522%252C%2522tiny-secp256k1%2522%252C%2522hash-wasm%2522%255D%257D%257D&amp;query=%24.size.compressedSize&amp;label=minzipped+size&amp;style=flat-square&amp;color=blue"></a>
</p>

## Features

- **Typed**: Source code is 100% TypeScript.
- **Tested**: Good code coverage and type relevance.
- **Minimal dependencies**: A few small trusted dependencies.
- **Cross-Environment Support**: Compatible with all major JS runtimes.
- **Integratable**: Easy to use with [viem](https://github.com/wevm/viem) accounts — local (private key) or JSON-RPC
  (browser wallet).

## Documentation

Browse the [SDK documentation](https://bloxwap.github.io/hyperliquid/docs/) for installation, clients, transports, signing,
utilities, and guides.

The documentation uses [Fumadocs](https://www.fumadocs.dev/) and is hosted on GitHub Pages. Its Markdown source lives in
`apps/docs/content/docs/` in the [repository](https://github.com/bloxwap/hyperliquid).

## Installation

### Bun 1.3.3+

```sh
bun add @bloxwap/hyperliquid
```

### Node.js 22.12+ / React Native 0.86+

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

> React Native needs polyfills for the `fastAssetCtxs` subscription and for versions below 0.86 — see the
> [documentation](https://bloxwap.github.io/hyperliquid/docs/).

## Quick Example

### Read

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

### Trade

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

For low-latency bots, prefer
[`createFastLocalWallet`](https://bloxwap.github.io/hyperliquid/docs/signing/#fast-local-wallet-wasm-secp256k1) (WASM
secp256k1) and install the optional `hash-wasm` package for ambient keccak acceleration. Trusted callers can also pass
`{ skipValidation: true }` — see the
[low-latency recipe](https://bloxwap.github.io/hyperliquid/docs/signing/#low-latency-recipe-bots--hft).

### Subscribe

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
>
> - **Never hardcode private keys** in source or commit them to git. Load them from environment variables or a secret
>   store (Bun auto-loads a local `.env`, which is gitignored in this repo).
> - For trading bots, prefer a Hyperliquid **agent wallet** (API wallet) over the master account key: an agent key can
>   trade but cannot withdraw, and it can be revoked without rotating the master key.
> - See [Signing](https://bloxwap.github.io/hyperliquid/docs/signing/) for how wallets, signatures, and nonces work.
