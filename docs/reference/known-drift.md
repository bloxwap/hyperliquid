# Known documentation drift

A living list of places where the
[official Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) and the live servers
disagree, and what this SDK does about it. Each entry is dated when observed; server behavior can change without
notice, so treat the "server reality" column as a snapshot, not a guarantee.

When an entry is resolved upstream (docs fixed, or server aligned with docs), move it to
[Resolved](#resolved) with the date rather than deleting it.

## Open

### 1. `l2Book` — `mantissa: 1` is documented but 500s

- **Observed:** 2026-07-26
- **Docs claim:** `mantissa` accepts `1`, `2`, or `5`
  ([l2Book](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot)).
- **Server reality:** `mantissa: 1` returns HTTP 500.
- **SDK behavior:** correct — `mantissa` is validated as `2 | 5` (or omitted), so the broken value is rejected
  client-side with a `ValidationError` before any request is sent (`src/api/info/_methods/l2Book.ts`).

### 2. `webData2` vs `webData3` subscriptions

- **Observed:** 2026-07-26
- **Docs claim:** `webData2` is listed among the WebSocket subscription channels.
- **Server reality:** the subscription channel the server actually serves for this aggregate user feed is `webData3`.
- **SDK behavior:** matches the server — [`SubscriptionClient`](../clients.md#websocket-subscriptions) implements
  `webData3` only. `webData2` remains available as an **info method** (`InfoClient.webData2`), which is unaffected.

### 3. `userFillsByTime` — undocumented `reversed` parameter

- **Observed:** 2026-07-26
- **Docs claim:** no `reversed` parameter is documented.
- **Server reality:** `reversed: true` works and returns fills newest-first.
- **SDK behavior:** supported — `reversed` is an optional boolean parameter of `InfoClient.userFillsByTime`
  (`src/api/info/_methods/userFillsByTime.ts`).

### 4. `userNonFundingLedgerUpdates` — `startTime` is optional, not required

- **Observed:** 2026-07-26
- **Docs claim:** `startTime` is a required parameter.
- **Server reality:** the request succeeds without `startTime`.
- **SDK behavior:** matches the server — `startTime` is optional (`src/api/info/_methods/userNonFundingLedgerUpdates.ts`).

### 5. `activeAssetCtx` with a spot coin pushes on `activeSpotAssetCtx`

- **Observed:** 2026-07-26
- **Docs claim:** subscribing to `activeAssetCtx` delivers frames on the `activeAssetCtx` channel.
- **Server reality:** when the subscription carries a spot coin, the server pushes frames on the
  `activeSpotAssetCtx` channel instead — for the identical `{ type: "activeAssetCtx", ... }` subscription payload.
- **SDK behavior:** handled — use `SubscriptionClient.activeSpotAssetCtx({ coin })` for spot. It sends the identical
  payload and listens on the channel the server actually uses, and the subscription manager keeps the two channels'
  listeners separate even though they share one server-side subscription
  (`src/transport/websocket/_subscriptionManager.ts`).

### 6. Unique users per connection — docs say 10, server allows 15

- **Observed:** 2026-07-26 (live mainnet).
- **Docs claim:** maximum of 10 unique users across user-specific WebSocket subscriptions (updated ~2026-07;
  [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)).
- **Server reality:** the 15th unique user was acknowledged; the 16th was rejected with
  `Cannot track more than 15 total users.`
- **SDK behavior:** matches the server — the subscription manager enforces 15 unique users per connection
  client-side (`MAX_UNIQUE_USERS = 15`, `src/transport/websocket/_subscriptionManager.ts`) and throws the same
  message before wasting a round trip. Note [Clients → Unsubscribe](../clients.md#unsubscribe) still quotes the
  docs' "10 unique users".

### 7. `TwapState` frames gained `trigger` / `stopPx`

- **Observed:** 2026-07-26 — tracked in
  [#48](https://github.com/bloxwap/hyperliquid/issues/48).
- **Docs claim:** `twapStates` frames carry the documented `TwapState` fields only.
- **Server reality:** frames now also include `trigger` and `stopPx`.
- **SDK behavior:** runtime unaffected — subscription payloads are delivered to listeners as received, so the new
  fields are present on the objects your listener gets. The `TwapState` **type**
  (`src/api/info/_methods/_base/_schemas.ts`) does not declare them yet, so they are invisible to TypeScript until
  #48 lands.

### 8. Outcome markets have no documented price/size precision

- **Observed:** 2026-07-26
- **Docs claim:** `outcomeMeta` returns no precision fields (no `szDecimals`, no tick size) — that much matches the
  server — and no precision model is documented anywhere for outcome markets.
- **Server reality (empirical):** orders behave like spot — spot-like tick size for prices, integer sizes. This is
  evidence-based, not protocol-guaranteed; size increments could change per market without notice.
- **SDK behavior:** the `OutcomeMetaResponse` type mirrors the docs (no precision fields,
  `src/api/info/_methods/outcomeMeta.ts`), and [`SymbolConverter`](../utilities.md#asset-id--symbolconverter)
  resolves outcome asset IDs (`100000000 + outcomeId * 10 + sideIndex`) from `outcomeMeta` alone. Format prices and
  sizes for outcome markets with the spot-like model above, at your own risk.

## Resolved

_None yet._
