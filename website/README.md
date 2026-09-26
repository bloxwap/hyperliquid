# Documentation website

[Fumadocs](https://www.fumadocs.dev) renders the canonical Markdown in [`../docs`](../docs/README.md).
Next.js exports the entire site, including the search index, as static files for GitHub Pages.
The website has its own dependencies and lockfile; they are not part of the published SDK.

## Design system

The design follows the Bloxwap monorepo's documentation site at commit `15201923b`:

- `app/brand-tokens.css` is a verbatim snapshot of `packages/ui/src/styles/tokens.generated.css`.
- Fumadocs colors, typography, navigation, and forced dark mode follow `workers/docs/src/app/global.css` and its layouts.
- The wordmark and favicon in `public/logos/` are copied from `workers/docs/public/logos/`, preserving their metadata.
- Nunito body text, Space Grotesk Bold headings, and Maple Mono code use local assets in `public/fonts/`.
  Nunito comes from the monorepo's `@fontsource-variable/nunito@5.3.0`; Space Grotesk and Maple Mono come from `workers/www`.
  All three SIL OFL license notices are included alongside the fonts.

Update these snapshots from the monorepo when its design changes. Keep the artwork and font notices intact.
Building this site does not require a checkout of the monorepo or a request to a font CDN.

## Develop

From the repository root:

```sh
cd website
bun install --frozen-lockfile
cd ..
bun run docs:dev
```

Open `http://localhost:3000`. No environment variables or API credentials are needed.
Use Node.js 22.12+ and the same Bun version as the repository's CI.

## Edit content

- Edit Markdown in `docs/`, retaining one visible H1 and `title`/`description` frontmatter.
- Add each new page to its folder's `meta.json` and the GitHub index `docs/SUMMARY.md`.
- Keep GitHub-compatible relative `.md` links. The website resolves them to routes during rendering.
- `README.md` becomes the folder's index route. `SUMMARY.md` is not published as a page.
- Native HTML details, summaries, and explicit anchors are supported. Existing code examples remain Markdown.

Run `bun run docs:check` from the repository root to check content and website types.
The repository's `bun run check` also formats and lints website source.

## Build and preview GitHub Pages

```sh
NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:build
NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:preview
```

Open `http://localhost:4173/hyperliquid/`. The preview serves only the static files in `website/out`.
The build verifies every documentation page, internal link, asset, and anchor, plus the static JSON search index and
`.nojekyll`. Build without `NEXT_PUBLIC_BASE_PATH` to serve at a domain root instead.

## Deploy

The [Documentation workflow](../.github/workflows/docs.yml) builds pull requests and publishes relevant changes on `main`.
In repository **Settings → Pages**, set **Source** to **GitHub Actions** before the first deployment. The workflow can also
be run manually from the Actions tab. Deployment uses GitHub's Pages artifact and deployment actions; no server, GitBook
connection, hosting token, or generated branch is required.

The published URL is `https://bloxwap.github.io/hyperliquid/`. The workflow uses the repository name as the base path, so
update public links and site metadata if the repository is renamed. Search is served at `/hyperliquid/search-index.json`
and runs in the browser.

Previous `bloxwap.gitbook.io` URLs are controlled by GitBook. Redirects from that hostname must be configured there if
desired; GitHub Pages cannot redirect requests sent to another provider's hostname.
