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

### 6. Unique users — docs say 10, the server's error says 15, the server enforces 14

- **Observed:** 2026-08-02 (live mainnet), superseding a 2026-07-26 observation.
- **Docs claim:** maximum of 10 unique users across user-specific WebSocket subscriptions (updated ~2026-07;
  [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)).
- **Server reality:** **14** distinct users are accepted; the **15th** is refused with an `error` frame reading
  `Cannot track more than 15 total users.` — the message is off by one from the enforcement. Measured by subscribing
  distinct users one at a time with the client-side guard disabled, twice, on two independent connections; both runs
  stopped at 14.
- **Scope:** **per IP, not per connection.** With one connection holding 14 users, a second connection from the same
  host was refused a 15th distinct user, while still being allowed to subscribe a user the first connection already
  held. Sharding user channels across sockets therefore buys no additional user slots.
- **SDK behavior:** enforces the measured 14 (`MAX_UNIQUE_USERS = 14`, `src/transport/websocket/_quota.ts`), counted
  against a per-IP [`WebSocketQuota`](../transports.md#websocket-limits) shared by every transport on the network.
  The earlier value of 15 was taken from the server's error text and was one too high — the 15th subscription passed
  the client guard, and because the server's refusal carries no echoed request, it could not be matched to the
  pending subscribe and surfaced only as a request timeout ~10 s later.

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

### 9. `outcomeMeta` outcomes gained a `deployer` field

- **Observed:** 2026-08-02 (live mainnet), via the `outcomeMeta` schema-coverage test.
- **Docs claim:** each entry of `outcomes` carries no `deployer`.
- **Server reality:** every outcome in the response now includes `deployer`; the schema-coverage check reports
  `additionalProperty: "deployer"` across the whole `outcomes` array (observed at indices 0 through 157+).
- **SDK behavior:** runtime unaffected — Info responses are delivered to callers as received, so the field is present
  on the objects you get. The `OutcomeMetaResponse` **type** in `src/api/info/_methods/outcomeMeta.ts` does not
  declare it yet, so it is invisible to TypeScript and `tests/api/info/outcomeMeta.test.ts` fails online until the
  type is widened. Per [Versioning](../README.md#versioning) that type change ships in a patch release.

### 10. `validatorL1Votes` actions gained `registerTemplate`

- **Observed:** 2026-08-02 (live mainnet), via the `validatorL1Votes` schema-coverage test.
- **Docs claim:** the validator action union covers `registerTokensAndStandaloneOutcome` among its variants.
- **Server reality:** a live vote carried an action whose `O` object holds `registerTemplate` and omits
  `registerTokensAndStandaloneOutcome`, so it matches no variant of the documented union — the check reports both
  `missingProperty: "registerTokensAndStandaloneOutcome"` and `additionalProperty: "registerTemplate"` for the same
  sample.
- **SDK behavior:** runtime unaffected for the same reason as #9; the union in
  `src/api/info/_methods/validatorL1Votes.ts` needs a `registerTemplate` variant, and
  `tests/api/info/validatorL1Votes.test.ts` fails online until it has one.

## Resolved

_None yet._
