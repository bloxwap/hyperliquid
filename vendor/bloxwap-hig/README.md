# Bloxwap HIG candidate packages

The docs site (`apps/docs`) consumes Bloxwap HIG as packages, not copied source. HIG has no npm release yet
(bloxwap/hig#32), so these are the unmodified tarballs from the HIG release dry run, installed with `file:`
dependencies. Nothing here is published, tagged or released.

- Source: [bloxwap/hig@7c67a07](https://github.com/bloxwap/hig/tree/7c67a07)
- Version: `0.1.0-candidate.sha7c67a07c`
- Produced by: `npm ci && npm run generate:fonts && npm run build && npm run release:dry-run -- --channel candidate`
  (`generate:fonts` needs `fonttools[woff]==4.61.1` and `brotli==1.2.0`; it fills `packages/tokens/assets/fonts`)

| Tarball | SHA-256 | Used for |
| --- | --- | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.sha7c67a07c.tgz` | `701750f9b85f148533995d9b603f2ea1a6acbe31ac475ac7f8ecce8cd3cd61dc` | `--hig-*` CSS variables, typed colors and the Open Graph TTF instances |
| `bloxwap-hig-react-0.1.0-candidate.sha7c67a07c.tgz` | `6f3d7cc721ff246c647a2479ba39e898f4ba9d2ba75177b800a9942f5dab11f9` | Recipe CSS and `button`, `status` and `provider` components |
| `bloxwap-hig-contracts-0.1.0-candidate.sha7c67a07c.tgz` | `4519befc8d35c787b2f91302cf46801c82295f6dd33cbf84331be11308d71ef7` | Runtime dependency of `hig-react` only |

`hig-react` pins its HIG dependencies to the candidate version, which is not on the registry. The root
`package.json` `overrides` point those transitive names at these files (`file:./vendor/bloxwap-hig/…`, relative to
the repository root), while `apps/docs` depends on them as `file:../../vendor/bloxwap-hig/…`. Bun therefore records
two `hig-tokens` lockfile entries for the same tarball (same integrity hash). Bun 1.4.4 canary, which CI uses, resolves
overrides from the root; Bun 1.4.0 resolved them from the dependent workspace and cannot install this lockfile.

## Update

1. Build the candidate tarballs from a reviewed HIG commit with the commands above.
2. Replace the three tarballs, update the file names in `apps/docs/package.json` and the root `overrides`, then run
   `bun install` and update the hashes and version above.
3. Run `bun run docs:check`, `NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:build` and
   `bun run --cwd apps/docs test:browser`.

Replace these files with registry versions once HIG publishes (bloxwap/hig#32). To roll back, revert the commit that
introduced this directory; it restores the previous plain-CSS copy and Open Graph fonts.
