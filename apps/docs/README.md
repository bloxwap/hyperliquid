# Documentation website

[Fumadocs](https://www.fumadocs.dev) renders the canonical Markdown in [`content/docs`](content/docs/README.md).
Next.js exports the entire site, including the search index, as static files for GitHub Pages.
The app is a private Bun workspace alongside [`packages/hyperliquid`](../../packages/hyperliquid/README.md).
Install dependencies from the repository root using the shared `bun.lock`. App dependencies and content are excluded
from the SDK package published from `packages/hyperliquid/dist`.

## Design system

The design follows the Bloxwap monorepo's documentation site at commit `15201923b`:

- `app/brand-tokens.css` is a verbatim snapshot of `packages/ui/src/styles/tokens.generated.css`.
- Fumadocs colors, typography, navigation, and forced dark mode follow `workers/docs/src/app/global.css` and its layouts.
- The app icon and favicon in `public/logos/` preserve the original Bloxwap artwork and metadata.
- Nunito body text, Space Grotesk Bold headings, and Maple Mono code use local assets in `public/fonts/`.
  Nunito comes from the monorepo's `@fontsource-variable/nunito@5.3.0`; Space Grotesk and Maple Mono come from `workers/www`.
  All three SIL OFL license notices are included alongside the fonts.

Update these snapshots from the monorepo when its design changes. Keep the artwork and font notices intact.
Building this site does not require a checkout of the monorepo or a request to a font CDN.

The [historical design review](design-review/README.md) preserves the original findings and screenshots from 2026-09-26.

## Develop

From the repository root:

```sh
bun install --frozen-lockfile
bun run docs:dev
```

Open `http://localhost:3901`. No environment variables or API credentials are needed.
Use Node.js 22.12+ and the same Bun version as the repository's CI.
The dev, build, and check commands generate Fumadocs source files before running; dependency installation needs no
code generation.

## Edit content

- Edit Markdown in `apps/docs/content/docs/`, retaining one visible H1 and `title`/`description` frontmatter.
- Add each new page to its folder's `meta.json` and the GitHub index `apps/docs/content/docs/SUMMARY.md`.
- Keep GitHub-compatible relative `.md` links. The website resolves them to routes during rendering.
- `README.md` becomes the folder's index route. `SUMMARY.md` is not published as a page.
- Native HTML details, summaries, and explicit anchors are supported. Existing code examples remain Markdown.

Run `bun run docs:check` from the repository root to check content and app types.
For content checks alone, run `bun run check:docs` from the root or `bun run check:content` from `apps/docs`.
The repository's `bun run check` also formats and lints app source.

## Build and preview GitHub Pages

```sh
NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:build
NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run docs:preview
```

Open `http://localhost:4173/hyperliquid/`. The preview serves only the static files in `apps/docs/out`.
The build verifies every documentation page, internal link, asset, and anchor, plus the static JSON search index and
`.nojekyll`. It also checks each page's social metadata and its distinct 1200 × 630 PNG card.

## Agent-readable files

The build also exports files that let AI agents use the site without rendering JavaScript:

- `public/llms.txt` is the curated entry point: what the SDK does, when to use it, and links to every page.
- `scripts/export-markdown.ts` runs after `next build` and writes a Markdown mirror for each documentation page
  (`/docs/clients/` → `/docs/clients.md`, served as `text/markdown`) plus a concatenated `llms-full.txt`.
- `app/sitemap.ts` emits `sitemap.xml`, and `public/robots.txt` explicitly allows AI crawlers.
- `/about/`, `/contact/`, and `/privacy/` are trust pages, and the homepage carries JSON-LD
  (Organization with a contact point, WebSite, SoftwareApplication).
- `app/not-found.tsx` gives the exported `404.html` an explanatory body with links to the docs, sitemap, and
  `llms.txt`.

`scripts/verify-export.ts` checks all of these after every build. GitHub Pages cannot do server-driven content
negotiation, so `Accept: text/markdown` requests still receive HTML; the `.md` mirrors are the Markdown path.
Build without `NEXT_PUBLIC_BASE_PATH` to serve at a domain root instead.

## Social cards

Every build creates an Open Graph card for the homepage and each documentation page. Page titles and descriptions come
from the same Markdown frontmatter used by the site; new pages receive cards automatically. Open Graph and Twitter
metadata share the same image, title, description, and accessible image text. Canonical URLs and social image URLs
always point to the published GitHub Pages site, including when previewing locally.

- `lib/og-image.tsx` defines the Bloxwap layout, accent colors, and typography.
- `lib/brand.ts` vendors the official brand geometry from the Bloxwap monorepo's `packages/tokens/src/brand.ts`.
  Cards draw the wordmark from these SVG paths. Re-copy the geometry from the monorepo when the marks change.
- `lib/social.ts` defines the published URL and metadata. Update it if the repository or public hostname changes.
- `app/og/[...slug]/route.tsx` generates `/og/index.png`, `/og/docs.png`, and `/og/docs/<slug>.png` during the static build.

Cards use Nunito Black for headlines, Nunito Bold for descriptions, and Space Grotesk Bold for product and category labels.
The static Nunito faces come from the Bloxwap monorepo's `packages/og/assets/`; their license is included as
`public/fonts/Nunito-OG-OFL.txt`. The existing Space Grotesk face retains its `public/fonts/SpaceGrotesk-OFL.txt` notice.
The renderer uses bundled fonts and brand geometry locally; it needs no font CDN, API credentials, or image server after
deployment. Generated PNGs live in `out/` and are included in the GitHub Pages artifact.

## Deploy

The [Documentation workflow](../../.github/workflows/docs.yml) builds pull requests and publishes relevant changes on `main`.
In repository **Settings → Pages**, set **Source** to **GitHub Actions** before the first deployment. The workflow can also
be run manually from the Actions tab. Deployment uses GitHub's Pages artifact and deployment actions; no server, GitBook
connection, hosting token, or generated branch is required.

The published URL is `https://bloxwap.github.io/hyperliquid/`. The workflow uses the repository name as the base path, so
update public links and site metadata if the repository is renamed. Search is served at `/hyperliquid/search-index.json`
and runs in the browser.

Previous `bloxwap.gitbook.io` URLs are controlled by GitBook. Redirects from that hostname must be configured there if
desired; GitHub Pages cannot redirect requests sent to another provider's hostname.
