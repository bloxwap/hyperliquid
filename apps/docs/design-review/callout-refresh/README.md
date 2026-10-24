# Callout candidate refresh · 2026-10-18

This follow-up to [bloxwap/hig#69](https://github.com/bloxwap/hig/issues/69) refreshes the docs from candidate
`7c67a07c` to exact clean `0e2394428a3971e677e0a97ef5259ac4ca1ec064`. The consumer baseline is
`3ce98ef377250406ad65a2b163b1a4161d2f9983`. [Vendored provenance](https://github.com/bloxwap/hyperliquid/blob/8056522454517528de0b94550e272d9679f83740/vendor/bloxwap-hig/README.md) and
[verification.json](verification.json) retain archive/report hashes, internal versions and font/card hashes.
Nothing is published or deployed by this change.

`note` and `tip` now use HIG's own Callout severities. Their labels, body content and accent roles remain the same;
`important`, warning and caution retain their prior mapping. Obsolete local note/important/tip accent edges are
removed. Static Callouts still set `announce={false}`. The page explicitly imports the opt-in `css/base` to retain
the old package's whole-page defaults; docs actions keep their existing 48px comfortable target using the control
token. No Markdown, routing, content, metadata or SDK subscription/signing code changes.

New tokens packages omit the old TTF asset path, so OG cards use `@bloxwap/hig-og-fonts/node` for their existing
Bold and Black faces. The loader verifies each subset against its manifest. All **14 exported social cards are
byte-identical** to the same-toolchain baseline; all **22 exported web fonts** retain their filenames, bytes and
SHA-256. Web faces still come from `@bloxwap/font` 0.1.2. Only HIG lock entries change; root overrides align the
renderer contracts/tokens, and both normal/frozen Bun 1.4.0 installs pass, including a separate empty install tree.

## Validation and production costs

- `bun run check`: format, lint, docs content/Markdown and SDK TS5/TS7/JSDoc/export/import gates passed.
- `bun run docs:check` passed. All 20 docs tests passed, including five canonical static Callout cases and two
  immutable archive/font provenance guards.
- SDK offline suite: 2,087 passed, 244 intentionally skipped, zero failures; live trading tests were not run locally.
- Production docs export: 13 docs pages, 20 HTML files, 1,168 internal references, 355 anchors and 14 social cards.
- Existing Playwright production suite: eight passed (shell, copy, search, mocked feed/error/retry, mobile/RTL and
  keyboard behavior). Its Callout case now asserts the actual `note` severity.
- [Paired Callout browser reports](before-browser.json): eight before/eight [after](after-browser.json) cases
  across Chromium/WebKit, 390/1440px and 100/200% text. Every callout retains exact text, width/height, font/size,
  line height, 3px edge role/color and no live region; no new overflow, page error or external request occurs.
  Sixteen JPEG captures are retained. Tip rendering is covered by the actual SSR component test; the existing
  utilities document contains Note/Warning callouts.

Node 22.22.0, Bun 1.4.0, Next 16.3.8 and Playwright 1.64.0 are used for both sides, with
`NEXT_PUBLIC_BASE_PATH=/hyperliquid` and reduced motion. [Before](before-sizes.json) and [after](after-sizes.json)
measure every exported asset with individual Node `gzipSync` defaults:

| Metric | Delta |
| --- | ---: |
| JS | +1,580 raw / +554 gzip B |
| CSS | +11,859 raw / +2,160 gzip B |
| Entire static export | +13,439 B; 199 files unchanged |
| Font payload | 0 B; 22 files unchanged |
| Vendored archives | −3,561,410 B (4,446,466 → 885,056 B) |

This is the cumulative candidate refresh cost, not an isolated Callout-runtime measurement or owner approval.
Formal rollout review and eventual registry replacement remain separate acceptance work.

## Reproduce

Use the pinned toolchain and install normally. The repository has no configured pre-push hook; push normally and
retain the repository's complete CI gates. Preview/deployment behavior remains the repository's existing workflow.

```sh
bun install --frozen-lockfile
bun run check
bun run docs:check
bun run --cwd apps/docs test
bun run test:offline
NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:build
NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run --cwd apps/docs test:browser
node apps/docs/scripts/measure-hig.mjs . after
```

To reproduce paired browser evidence, first build baseline `3ce98ef` with identical commands/toolchain and save
its `apps/docs/out` in a separate directory, then build the current export:

```sh
node apps/docs/scripts/verify-callout-refresh.mjs before /absolute/path/to/baseline-out
node apps/docs/scripts/verify-callout-refresh.mjs after apps/docs/out
```
