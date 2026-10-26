# HIG registry adoption · 2026-10-23

The documentation now installs the coordinated `@bloxwap/hig-react`, `@bloxwap/hig-tokens`,
`@bloxwap/hig-contracts` and `@bloxwap/hig-og-fonts` `0.1.0` registry packages from the
[HIG release](https://github.com/bloxwap/hig/releases/tag/v0.1.0).
Three docs dependencies are pinned directly; the renderer pins its two internal dependencies.
`bun.lock` records npm SHA-512 integrity values. The candidate overrides, four committed tarballs
(885,056 bytes), and candidate-only verification metadata are removed.

The existing artifact test now resolves the installed packages and verifies coordinated versions,
absence of vendored dependencies/overrides, and the actual Bold/Black OG font bytes against the
shipped manifest. Existing Callout semantics and browser interactions remain covered.

The normal three-day dependency release-age policy is unchanged. The initial lock update used Bun
1.4.4's exact-version command-line exemption for these four owner-released `0.1.0` packages only;
subsequent frozen installs need no exemption. CI also found pre-existing vulnerabilities in the
root lockfile: `fast-uri` 3.1.8 and `zod` 4.6.5. These are patched to 3.1.9 and 4.6.7, respectively,
using registry integrity values within their existing dependency ranges. The Zod change matches
[PR #216](https://github.com/bloxwap/hyperliquid/pull/216). All other non-HIG locked versions are unchanged.

## Verification

All checks passed on Bun 1.4.4 and Node 24.6.0: 20 documentation unit tests and 10 Chromium
production interaction tests. The static build verified 13 docs pages, 20 HTML files, 1,119 internal
links/assets, 367 anchors and 14 unique social cards. Root formatting, lint, SDK checks and docs types passed. OSV-Scanner 2.3.8 reports zero findings
across both checked lockfiles after the two security patches.

- `bun install --frozen-lockfile`
- `bun run check`
- `bun run docs:check`
- `bun run --cwd apps/docs test`
- `NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:build`
- `bun run --cwd apps/docs test:browser`

The source SDK and API behavior are unchanged. The original [Callout refresh evidence](callout-refresh/README.md)
remains historical evidence for its recorded source and toolchain, with immutable links to the old archives.

Rollback is a revert of this migration commit, restoring its prior manifests, lockfile and candidate archives.
No consumer-owned data or remote settings change. This completes Hyperliquid's registry migration tracked by
[bloxwap/hig#56](https://github.com/bloxwap/hig/issues/56).
