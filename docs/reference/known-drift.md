---
title: Known documentation drift
description: Verified differences between the official Hyperliquid documentation, live servers, and SDK types.
---

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
- **SDK behavior:** supported — `TwapState` declares both fields as optional and nullable, preserving compatibility
  with older responses. Set a trigger through `twapOrder.details.t` (`{ p, a }`) and a stop price through
  `twapOrder.details.s`; either setting can be `null`. Responses use `trigger: { px, above }` and `stopPx`.
  Live mainnet history tests cover non-null values and the `waitingForTrigger` / `stopped` statuses; offline
  fixtures also cover older responses that omit the fields. The original type gap tracked in #48 is fixed.

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
- **SDK behavior:** fixed — `OutcomeMetaResponse` in `src/api/info/_methods/outcomeMeta.ts` declares
  `deployer` as an optional field, so it is typed and the schema-coverage test accepts it. The docs still don't
  mention the field, so this entry stays open until they do.

### 10. `validatorL1Votes` actions gained `registerTemplate`

- **Observed:** 2026-08-02 (live mainnet), via the `validatorL1Votes` schema-coverage test.
- **Docs claim:** the validator action union covers `registerTokensAndStandaloneOutcome` among its variants.
- **Server reality:** a live vote carried an action whose `O` object holds `registerTemplate` and omits
  `registerTokensAndStandaloneOutcome`, so it matches no variant of the documented union — the check reports both
  `missingProperty: "registerTokensAndStandaloneOutcome"` and `additionalProperty: "registerTemplate"` for the same
  sample.
- **SDK behavior:** fixed — the union in `src/api/info/_methods/validatorL1Votes.ts` includes the
  `registerTemplate` variant (and the `settleQuestion2` variant added alongside it), so live votes validate. The
  docs still don't show the variant, so this entry stays open until they do.

### 11. Aug-2026 outcome-template API snapshot

- **Observed:** 2026-08-23.
- **Docs at that date:** the info-endpoint and exchange-endpoint pages had no entries for `outcomeTemplates`,
  `usdcRouting`, `activateOutcomeDeployer`, the `spotDeploy` outcome sub-actions
  (`registerStandaloneOutcomeFromTemplate`, `registerQuestionFromTemplate`, `settleOutcome`, `settleQuestion2`),
  `twapOrder`'s `details` (trigger/stop), `reserveRequestWeight`'s `destination`, or `marginTable`'s `dex`
  parameter.
- **Server at that date:** these additions shipped in the Aug-2026 "HIP-4 outcome templates" API drop.
- **SDK behavior:** the August schemas were implemented against the reference TypeScript SDK
  ([nktkas/hyperliquid](https://github.com/nktkas/hyperliquid) v0.33.3), which tracks the deployed API, then
  widened where live testnet responses went further: `outcomeTemplates` serves keyword formats `uDecimal`, `uInt`,
  and `shortString` and a `role` union of `standaloneOutcome` / `questionOutcome` / `"question"` that the upstream
  schema doesn't cover (observed 2026-08-24). The deployment action formats have since changed on testnet;
  see [the September verification](#12-hip-4-deployment-now-requires-venues) for the remaining compatibility gap.

### 12. HIP-4 deployment now requires venues

- **Verified:** 2026-09-26 against `https://api.hyperliquid-testnet.xyz`.
- **Docs:** [HIP-4 deployer actions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions)
  describe activation with `activate: { venueName }` or `deactivate: null`, and deployment through
  `outcomeDeploy` with `venue` and `operation`.
- **Server reality:** both activation variants and all six documented deployment operations parse successfully
  and reach signature recovery. The legacy `isDeactivate` forms and `spotDeploy.outcome` registration return
  HTTP 422. Omitting `venue` or a standalone template's `deployerFeeScale` also returns HTTP 422.
- **Verification scope:** every exchange probe uses `r = s = 0`, an invalid ECDSA signature. Recognized formats
  return `Unable to recover signer.` No action executes. These results verify request parsing, not staking,
  permissions, settlement rules, or successful deployment. Repeat with
  `bun run .dev/verify_hip4_actions.ts`.
- **SDK gap:** `activateOutcomeDeployer` still requires `isDeactivate`, and deployment operations still use
  `spotDeploy.outcome`. The SDK needs the new activation union and an `outcomeDeploy` method, including template
  fee scales, `registerAndAssociateNamedOutcomeFromTemplate`, and `setSubDeployers`.
- **Read API gap:** testnet `outcomeMeta` also returns top-level `deployers` and `feeScale`, and optional per-outcome
  `venue` and `deployerFeeScale`, which the current response type does not declare. The queried templates still
  omit the documented `semanticRestriction` field; its live shape remains unverified.

## Resolved

_None yet._
