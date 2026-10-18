# Bloxwap HIG candidate packages

The docs consume unmodified, unpublished HIG release-candidate archives with `file:` dependencies.

- Source: [bloxwap/hig@0e239442](https://github.com/bloxwap/hig/tree/0e2394428a3971e677e0a97ef5259ac4ca1ec064)
- Version: `0.1.0-candidate.sha0e239442`
- Clean source: `sourceTreeDirty:false`, recorded before evidence/report generation
- Exact [source report](source-report.json), SHA-256 `2874bfd8b00d47ef90cbf21f4dee1cd98c5522919c08c915b4ff8386d3a799ce`
- [Manifest](manifest.json) pins archive bytes and SHA-256. `apps/docs/lib/hig-artifacts.test.ts` verifies archives,
  internal versions, aligned HIG dependencies and report provenance.

| Tarball | SHA-256 | Bytes |
| --- | --- | ---: |
| `bloxwap-hig-tokens-0.1.0-candidate.sha0e239442.tgz` | `0bca5a6aa3317731166155de16f61e24e4fab9085b9e112bdc50e958f8c21d6e` | 8,226 |
| `bloxwap-hig-contracts-0.1.0-candidate.sha0e239442.tgz` | `1f9305549e7d76224c188b7f22991561441e39e2b1d3bde27fd176810ab4d031` | 7,206 |
| `bloxwap-hig-react-0.1.0-candidate.sha0e239442.tgz` | `32c8839ac38b9ba9be714c81f2952bfef94d76d875d2bd6991a999fbb820c024` | 25,592 |
| `bloxwap-hig-og-fonts-0.1.0-candidate.sha0e239442.tgz` | `05d0e920f0988bc105a5e9374a33783f6cca4fe27eea409cd97dc236fb7c2864` | 844,032 |

`apps/docs` directly consumes tokens, renderer and the dedicated OG fonts. Root overrides pin the renderer's
contracts/tokens to the same candidate. The Node OG loader verifies the existing Bold/Black faces against its
font manifest; no native-font package or tokens-owned TTF path is needed. The site still registers its web faces
from `@bloxwap/font` 0.1.2. All 14 exported cards and all 22 web-font payloads match the prior candidate exactly.

The refreshed lock installs with Bun 1.4.0 (`bun install` and `bun install --frozen-lockfile`); the old candidate's
workspace-relative override warning is historical. Non-HIG lock entries are unchanged.

## Update

1. Copy the reviewed clean candidate's exact archives and release report; do not edit archive/report bytes.
2. Update both package manifests, this manifest and provenance, then run `bun install` and frozen install.
3. Run `bun run check`, `bun run docs:check`, `bun run --cwd apps/docs test`,
   `NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:build` and `bun run --cwd apps/docs test:browser`.
4. Compare the production Callout geometry/text/edges, font hashes, social-card hashes and export sizes.

[Refresh evidence](../../apps/docs/design-review/callout-refresh/README.md) records the original source/toolchain
and measurements. Registry replacement remains [bloxwap/hig#56](https://github.com/bloxwap/hig/issues/56).
Reverting this refresh restores the prior candidate archives, note/tip mapping and OG font resolver.
