# HIG adoption evidence · 2026-10-13

> Superseded by the [HIG package migration](../hig-packages/README.md), which replaces the plain-CSS copy and
> `vendor/hig` described below with the packed HIG candidate packages.

Hyperliquid adopts the approved plain CSS path from
[bloxwap/hig #34](https://github.com/bloxwap/hig/issues/34) and the
[SDK migration kit](https://github.com/bloxwap/hig/blob/1a776b9326c6ba03702894943b3edbfd178c4b40/docs/migration/sdk-docs.md).

Source baseline: Hyperliquid `4a312a211cd04e187d680111f47d2a1b1dea5ef1`.
HIG: 0.1.0 candidate, commit `1a776b9326c6ba03702894943b3edbfd178c4b40`.
Distribution provenance and SHA-256 hashes are in `../../vendor/hig/README.md`.
The candidate is a private local file package, without an npm publication.

Fumadocs retains the page tree, mobile sidebar, search dialog/Orama index,
MDX code/callout adapters and all docs URLs. HIG supplies shared tokens and
CSS primitives; host aliases bridge the existing shell and SDK forms/states.
Bloxwap Sans/Mono remain pinned to 0.1.2, including script companions.
Space Grotesk and its loader/license are removed. Static OG font instances
remain necessary for Satori; their existing provenance/licenses are preserved.
The market playground keeps its SDK transport, feed, reconnect and cleanup logic.
Feedback is muted (no audio/haptic dependency); reduced motion uses OS CSS.

## Measurement

`before.json` and `after.json` count uncompressed exported CSS/JS, Next font
files, public TTFs and authored CSS. These are all export assets, not initial
page download sizes. Next's build cache can retain unused assets, so no
initial-load or tree-shaking claim is made from these totals.

Before/after screenshots use Chromium, 1440×1000 desktop and 390×844 mobile,
with reduced motion enabled. Reproduce from the repository root against the
static preview with `node apps/docs/scripts/capture-hig.mjs before` (or `after`).
The baseline was rebuilt successfully after an initial transient Next.js
`Expected workStore to be initialized` prerender failure.

## Validation

Production build uses `NEXT_PUBLIC_BASE_PATH=/hyperliquid`, `output: export`,
trailing slashes and unoptimized images. Export verification covers all 13 docs
pages, 20 HTML files, 355 anchors, social cards, static search and agent mirrors.
The docs browser suite runs against this same export in CI. It covers keyboard
install selection, clipboard success/denial, search results/empty/offline states,
mobile sidebar/deep links, large text/RTL reflow, and the actual SDK subscription
path with deterministic WebSocket frames for payloads/asset changes/off/error/retry.
Mock frames prove host integration, not upstream availability or real market prices.
A separate unmocked browser session reached Live and received a BTC mid-price;
its timestamp and payload are recorded in `live-market.json`.
The footer now follows the content so it cannot cover the playground.
Reduced-motion selectors match the entrance-animation specificity so all hero
content respects the OS setting; the browser suite checks the computed animation.

Local commands: `bun run check`, `bun run docs:check`, `bun run docs:build`,
`bun run build`, `bun run test:offline --timeout 30000`, `bun run --cwd apps/docs test`, and
`bun run --cwd apps/docs test:browser`. See the owning PR for final results.

## Adoption matrix (owning repository scope)

| Repository | Version / owning evidence | Status / remaining validation |
| --- | --- | --- |
| Hyperliquid | HIG 0.1.0 candidate; [PR #179](https://github.com/bloxwap/hyperliquid/pull/179) and committed evidence | Shared shell adoption; physical-device validation pending |
| Chart | Not changed by this PR | Owning PR/build/demo evidence required |
| Font | Not changed by this PR | Owning PR/build/tester evidence required |
| SFX | Not changed by this PR | Owning PR/build/sound-board evidence required |
| Haptic | Not changed by this PR | Owning PR/build/platform demo and physical tactile evidence required |

Exceptions, review 2026-11-13: #32 has no npm release; replace the pinned local
CSS distribution when official packages ship. Fumadocs remains the host shell
adapter, rather than replacing its router/search with HIG's standalone catalog.
No physical devices, iOS hardware, VoiceOver/TalkBack, native tactile response,
or wide-gamut display fidelity can be certified on this Linux VM. Browser
viewport/RTL/font-size tests are explicitly browser checks. No production
settings, deployment steps, tags, releases or npm publications were changed.
HIG's upstream adoption ledger and issue checklist remain for its maintainers;
this PR only records the Hyperliquid row and does not claim all five migrated.

Rollback: revert the owning squash commit to restore the baseline token CSS,
fonts and clipboard components. Docs content and SDK APIs have no migration diff.

## Local results

- Aggregate check, docs typecheck, lint and formatting: pass (existing lint warnings only).
- SDK build: pass, including published consumer/import identity verification.
- Offline SDK: 2,087 pass, 244 skip, zero failures; 76,722 assertions across 255 files.
  Live endpoint tests are skipped by the suite's offline setting. The initial run
  timed out in an existing HIP-3 schema snapshot at five seconds under VM memory
  pressure; the complete rerun used Bun's 30-second timeout with unchanged assertions.
- Docs helpers: 10 pass, zero failures, 30 assertions.
- Production browser interactions: six pass, zero failures.
- Export CSS: 159,189 → 158,685 bytes.
  JavaScript: 1,355,870 → 1,356,112 bytes. Public TTFs: 1,009,020 → 892,964 bytes.
  Runtime dependencies: one private CSS package added, zero runtime JS packages added.
  Development only: Playwright test runner and its two transitive packages added.
