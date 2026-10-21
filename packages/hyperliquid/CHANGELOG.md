# Changelog

All notable changes to `@bloxwap/hyperliquid` are documented in this file.

## Unreleased

### Added

- `ExchangeSingleWalletConfig.wallet` accepts a raw 32-byte hex private key string, in addition to wallet objects.
  Such keys sign in-process with WASM secp256k1 (`tiny-secp256k1`, an optional dependency) by default: the module is
  loaded through an opaque dynamic import, shape-validated, and must pass a known-answer signature self-check before
  it is used. When WASM is unavailable or fails the self-check (the usual outcome in browsers and bundled apps),
  signing silently falls back to the pure-JS `@noble/curves` implementation. Both backends produce byte-identical
  signatures. A malformed key string throws `AbstractWalletError` synchronously from the `ExchangeClient`
  constructor; a well-formed key outside the secp256k1 scalar range rejects on the first signing call. To opt out of
  the WASM path, pass a viem account (`privateKeyToAccount(key)`) or `createFastLocalWallet(key, { wasm: false })` as
  before. Measured on an Intel Xeon box with a zero-latency mock transport: `ExchangeClient.order()` goes from ~274 to
  ~104 µs per order on Node 24 and from ~155 to ~102 µs on Bun 1.4 compared with a viem `privateKeyToAccount`.
- `getWalletAddress`, `getWalletChainId` and `warmupSigning` accept the raw private key string form too, so
  `getWalletAddress(client.config.wallet)` keeps type-checking and working for either form.
- `@noble/curves` (2.2.0, the release paired with the existing `@noble/hashes` 2.2.0) is a new dependency. It is
  loaded only through a dynamic import, and only when a raw key cannot use WASM.

### Changed

- `exchange.warmup()` / `warmupSigning` treat a raw private key string as an in-process key: they await its backend
  initialization and sign the throwaway warm-up actions with it. Wallet objects behave exactly as before.
