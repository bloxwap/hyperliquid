# Changelog

All notable changes to `@bloxwap/hyperliquid` are documented in this file.

## 0.7.0 - 2026-10-23

### Added

- Exchange wallet configuration accepts raw 32-byte hex private key strings. Local signing uses optional WASM
  secp256k1 after a known-answer self-check, with a byte-equivalent pure-JS fallback. Existing wallet objects remain
  supported.
- `getWalletAddress`, `getWalletChainId`, and `warmupSigning` accept raw private key strings too.
- Info methods and `InfoClient` accept opt-in `skipValidation` options for trusted parameters already in wire form,
  while retaining request cancellation.
- `spotDeploy` supports `setTokenAnnotation` and `setDeployerLabel` actions.

### Fixed

- Time-ranged pagination preserves cumulative boundary multiplicities across repeated full pages, preventing
  duplicate records and unnecessary requests.
- Public WebSocket message listeners correctly track callback identity, capture flags, `once`, and abort signals.
  Removing an unregistered listener no longer suppresses a live listener.
- Cancelling a subscription's final local lease removes an unsent attempt from quota and disconnected-socket
  queues, while preserving other subscribers' leases.
- Compressed asset feeds retire recipients immediately on cancellation, failure, and `unsubscribeAll`, including
  pending confirmations and nested client trackers.

### Performance

- MessagePack encoding retains encoded prefixes when optional properties are explicitly `undefined`, preserving
  byte-for-byte action hashes without replaying large subtrees.
- HTTP transports cache rate-limit weights for reused immutable exchange actions and avoid redundant parsing for
  verified Info request types.
- WebSocket confirmation matching indexes rewritten subscription echoes. Compound routing selects matching
  candle intervals, users, and DEXs before invoking listeners.
- Bounded dispatch uses indexed eligibility and cumulative overtake accounting under queue pressure, retaining a
  lightweight path for small lanes and preserving nonce-window and wire-order guarantees.
- Cancelled timeout entries release their controllers promptly; queue compaction bounds retention behind stalled
  requests.
- Compressed asset feeds share decoding across client and free-function subscriptions, skip obsolete queued work,
  and avoid one full snapshot copy per multi-recipient frame.
- L1 multisig signers share a lazily computed inner digest. Typed-data-only wallets do not trigger unused hashing.
- Selected builder-DEX metadata requests overlap unrelated metadata loading while replacement mappings publish
  atomically.
- Transport-only and signing-only imports avoid loading the validation library.

### Changed

- Runtime dependencies now use `@noble/curves` and `@noble/hashes` 2.4.0 and Valibot 1.5.0. The curves dependency is
  loaded dynamically when raw-key signing cannot use WASM.
- `exchange.warmup()` and `warmupSigning` initialize and warm the local signing backend for raw private keys.
- Declaration builds and the primary type check use tsrs. Published consumers remain verified with TypeScript
  5.9; set `HL_TSC=tsc` for the declaration-build fallback or run `bun run typecheck:tsc` for its type check.
- Documentation uses the HIG presentation, updated callouts and fonts, and deferred search, market SDK, and
  animation dependencies. Documentation and development dependencies are refreshed.

### Upgrading from 0.6.0

Wallet-object configurations remain supported. The wallet field can now also be a private key string; use
`getWalletAddress` and `getWalletChainId` when reading either form. Request validation remains enabled by default.
The Node.js minimum remains 22.12.0.

Full comparison: https://github.com/bloxwap/hyperliquid/compare/v0.6.0...v0.7.0
