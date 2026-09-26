# Design review: documentation website

This historical review captures the site on 2026-09-26 in its former `website/` layout. The application now lives in
`apps/docs/`. The findings and file references below describe that reviewed snapshot; screenshots are stored alongside
this report.

Scope: the Next.js + Fumadocs documentation site. That covers the custom landing page (`app/page.tsx`), the docs
shell (`app/docs/`), search (`components/search.tsx`), and the custom styling in `app/global.css` and
`app/brand-tokens.css`. The SDK itself has no UI. Reviewed against the 30-check catalog.

- **Static pass:** done.
- **Visual pass:** desktop at 1440 px. Mobile at 390 px, rendered in iframes because Chrome would not shrink the window
  that far.
- **Flow pass:** landing → docs, then search with results, while loading, and with no results.
- **Light mode was not reviewed:** the site forces dark mode (`forcedTheme: "dark"`, theme switch disabled), so there is
  no light mode to screenshot.

## Verdict

The site is clean, on-brand, and has one clear primary action. Its biggest lever is **subtraction**. The landing page
draws six bordered, filled boxes plus two rules. Components mix two surface colors and reach past the tokens to the raw
neon brand primitives. Almost nothing animates between states. Cutting the boxes down to one emphasis surface (the code
window) and moving components onto semantic tokens fixes most of the findings below at once.

## Findings

| ID | Check | Where | Finding | Fix |
|---|---|---|---|---|
| F1 | LAY-2 / LAY-1 | `global.css:161-171, 180-197, 232-259, 289-298, 359-373`; `01-landing-desktop.jpg` | Six bordered + filled surfaces on the landing page (install box, code window with two inner rules, three feature cards, secondary button) plus a footer rule. The docs sidebar footer stacks a rule, a bordered GitHub box, and a bordered "Open Bloxwap" box | Keep the code window as the one emphasis surface. Drop the borders and fills on the feature cards, the install box, and the footer rule. Group with spacing instead |
| F2 | COL-1 | `global.css` (18 × `var(--bloxwap-*)`); `--card` vs `--color-fd-card` | Components reference brand primitives directly. There are two parallel "card" tokens with *different* values: `--card` is oklch 0.205 gray, `--color-fd-card` is `#0a0a0a`. The install box, code window, and secondary button sit on gray; the feature cards sit on black | Add semantic aliases (`--color-surface-raised`, `--color-accent`, `--color-text-muted`) and sweep the components to them. Delete the duplicate card token |
| F3 | MOT-5 | `components/search.tsx:17-23`; `04-search-loading-no-feedback.jpg` | The first search downloads an 830 KB static index. For over a second after typing, the dialog shows nothing below the input: no results, no loading state | Prefetch the index when the dialog opens, and render skeleton rows while `query.isLoading` |
| F4 | IMG-1 | `app/page.tsx:46,49,102,110`; `app/docs/layout.tsx:15`; `[[...slug]]/page.tsx:34` | Unicode glyphs (`↗ → $`) stand in for icons next to Fumadocs' Lucide icons. `↗` marks both internal links ("Get started", feature cards) and external ones (GitHub, "Open Bloxwap") | Use `lucide-react` (already installed through Fumadocs): `ArrowRight` for internal links, `ArrowUpRight` for external only, at one size and stroke |
| F5 | COL-2 | `components/provider.tsx:9`, `lib/layout.shared.tsx:21`, `brand-tokens.css` | Dark mode is forced. `:root` and `.dark` hold identical values, so no light palette exists. That is deliberate for the brand, but the catalog treats light/dark parity as the norm | Either record dark-only as a brand decision, or add light aliases in the semantic layer (F2 makes this a token-only change) |
| F6 | TYPE-4 | `global.css` (11 distinct sizes) | Raw `font-size` values of 10, 11, 12, 13, 14, 16, 17, 18, and 20 px, plus two rem sizes, all outside the defined scale (`--text-2xs`/`--text-3xs` + Tailwind's ladder). Three labels sit at 10 px | Map 10/11 → `text-2xs`, 12 → `text-xs`, 13/14 → `text-sm`, 16/17 → `text-base`, 18 → `text-lg`, 20 → `text-xl`. Raise the 10 px labels to 11 px |
| F7 | LAY-3 | `global.css` (19 off-grid values) | 90, 55, 27/22, 28/31, 11/14, 15/18, 26/28, 85, 13/10, 42/22, 50, 35… | Snap to 4/8/12/16/24/32/48/64/96 |
| F8 | BTN-5 | `global.css:128-160, 257-259, 374-377` | Only one element in the stylesheet transitions (the feature-card arrow). Button, card, and link hovers snap instantly. The primary hover mixes green into *transparent*, so the button dims toward the background instead of brightening | Add `transition: background-color, color, border-color, transform 160ms ease-out` to interactive elements. Brighten on hover rather than fading |
| F9 | COL-3 | `brand-tokens.css:5-43`, `global.css:32,36,341,356-357` | Full-saturation `#00ff3f` / `#ff479c` on near-black, identical in both theme blocks. Used for the active sidebar item, focus rings, link hover, and syntax colors | Give the accent roles dark aliases at about 60–70% intensity. Keep full neon for the primary button fill only |
| F10 | FORM-4 | `global.css:54-57`; `06-search-empty-and-focus.png` | The site-wide `:focus-visible` rule draws a square-cornered, 3 px-offset neon rectangle around the search input inside the rounded dialog. The input has no focus state of its own | Exempt text inputs from the global outline and give the search input a designed focus (subtle surface shift or inner ring that matches the dialog radius). Keep the outline for keyboard focus on links and buttons |
| F11 | BTN-3 | `global.css:128-152`; hero | The two hero pills differ in width and in icon gap (20 px vs 10 px) | Share a `min-width` and a single icon gap |
| F12 | MOT-6 | search empty state; `06-search-empty-and-focus.png` | "No results found" is a lone centered gray line | Offer a next step: links to the top docs sections or a "search the reference" suggestion |
| F13 | MOT-2 | `app/page.tsx` hero | The landing hero appears all at once | Stagger three layers 0.2 s apart (headline → description + CTAs → code window), ease-out, disabled under `prefers-reduced-motion` |

No finding reached P0. Every finding above is P1 (F1–F5) or P2 (F6–F13).

## P1 detail

### F1: Border and box soup on the landing page (LAY-2 / LAY-1)

**Evidence.** `01-landing-desktop.jpg` shows these surfaces on one screen:

- the install box
- the code window, with a toolbar rule and a status rule inside it
- three feature cards
- the secondary button
- the footer rule

Each has a border, and most also have a fill. At 390 px (`07-mobile-390-landing-and-docs.jpg`), the cards become three
tall bordered boxes in a row.

**Why it matters:** the eye reads the borders before the content, and hierarchy flattens into a grid of boxes.

```css
/* global.css — keep the code window as the one emphasis surface */
.feature-card {
  padding: 16px 0;
  border: 0;
  background: none;
}
.feature-card:hover h2 { color: var(--color-accent); }
.install-command {
  padding: 8px 0;
  border: 0;
  background: none;
}
.landing-footer {
  border-top: 0;
  padding-top: 0;
  margin-top: 64px;
}
```

In the sidebar footer, drop `.docs-sidebar-footer`'s `border-top` and render "Open Bloxwap" as a plain link row. The
bordered GitHub box comes from Fumadocs itself, so leave it as the one framed element.

Source: https://x.com/zander_supafast/status/2080000671781110136 · https://x.com/zander_supafast/status/2084623671444799847

### F2: Components bypass semantic tokens, and two "card" colors diverge (COL-1)

**Evidence.**

- `global.css` references `--bloxwap-green`/`-blue`/`-pink` 18 times inside component rules. Examples: lines 51, 140,
  243, 258, 341, 356–357, 376.
- `--card` (oklch 0.205, a gray) and `--color-fd-card` (`var(--bloxwap-black)`) are both used as the card background.
  So the install box, code window, and secondary button are gray while the feature cards are black.

**Why it matters:** components that reach past semantics can't be re-themed, and the two card colors make the surfaces
inconsistent.

```css
/* global.css — one semantic layer, components use only these */
:root {
  --color-surface: var(--bloxwap-black);
  --color-surface-raised: var(--card);
  --color-accent: var(--bloxwap-green);
  --color-accent-soft: color-mix(in oklab, var(--bloxwap-green) 65%, var(--bloxwap-black));
  --color-text-muted: var(--muted-foreground);
  --color-line: var(--border);
}
/* then e.g. */
.syntax-green { color: var(--color-accent); }
#nd-sidebar a[data-active="true"] { color: var(--color-accent-soft); }
```

Source: https://x.com/zander_supafast/status/1875103802082382115

### F3: Search has no loading state (MOT-5)

**Evidence.** `04-search-loading-no-feedback.jpg`: with "warmup" typed and one second elapsed, the dialog is still an
empty input bar. `search-index.json` is 829,493 bytes and is fetched on the first keystroke. With a warm cache the same
query returns results (`05-search-results.jpg`).

**Why it matters:** a blank dialog after typing looks broken. On a slow connection, the loading moment decides whether
people keep using search.

```tsx
// components/search.tsx: start the index download when the dialog opens, and show a loading row
import { useEffect } from "react";

export default function DocsSearchDialog(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({ client });
  useEffect(() => {
    if (props.open) void fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/search-index.json`);
  }, [props.open]);
  // …
  <SearchDialogList
    items={query.data !== "empty" ? query.data : null}
    Empty={() => (query.isLoading ? <SearchSkeleton /> : <SearchEmpty />)}
  />
```

The `Empty` render prop follows Fumadocs' `SearchDialogList` API. `SearchSkeleton` is three pulsing rows, and
`SearchEmpty` is the F12 fix.

Source: https://x.com/zander_supafast/status/1554384338619453440

### F4: Glyph arrows instead of one icon library (IMG-1)

**Evidence.** `↗` appears on "Get started" (internal, `/docs/`), on the feature cards (internal), on "View on GitHub"
(external), and on "Open Bloxwap" (external). `→` appears on "Explore the guides" (internal). These glyphs render in
the text font, next to Fumadocs' Lucide icons in the nav and sidebar.

**Why it matters:** mixed icon sources look unpolished. Using `↗`, the external-link arrow, on internal links also
misleads readers.

```tsx
// app/page.tsx
import { ArrowRight, ArrowUpRight } from "lucide-react";

<Link className="button-primary" href="/docs/">
  Get started <ArrowRight size={16} strokeWidth={2} aria-hidden />
</Link>
// external only:
<a href="https://github.com/bloxwap/hyperliquid">
  View on GitHub <ArrowUpRight size={14} aria-hidden />
</a>
```

`lucide-react` is already installed through `fumadocs-ui`. Add it as a direct dependency before importing it.

Source: https://x.com/zander_supafast/status/1836024015778918554

### F5: Dark mode only (COL-2)

**Evidence.** `RootProvider theme={{ forcedTheme: "dark" }}`, `themeSwitch: { enabled: false }`. In
`brand-tokens.css`, the `:root` and `.dark` blocks are byte-identical.

**Why it matters:** the catalog treats both modes as first-class. Docs are read in bright rooms and printed, and some
readers set their OS to light mode.

**Fix.** If dark-only is a firm brand choice, record that decision next to `forcedTheme` and close this finding.
Otherwise, once F2 is in place, add a light block for the semantic layer only (surface, text, line, accent-soft) and
re-enable the switch. No component changes are needed.

Source: https://x.com/zander_supafast/status/1875103802082382115

## Systemic recommendations

These are the fixes that clear whole classes of findings at once:

1. **One semantic token layer (F2)** is the root of F5, F9, and part of F1. Components should use only `--color-*`
   semantics. The brand primitives stay in `brand-tokens.css`.
2. **A spacing and type scale in `@theme` (F6, F7).** Define the 4 px spacing ladder and use the existing text ladder,
   then replace the 30 raw px values in `global.css`. Because `global.css` is hand-written CSS rather than Tailwind
   classes, the practical move is CSS variables (`--space-2: 8px` …) swept in one pass.
3. **One interactive-state recipe (F8, F10, F11).** Write a shared `.interactive` rule (transition, hover brighten,
   active press, focus ring that matches the element's radius) and apply it to the buttons, cards, and sidebar links.
4. **Replace glyphs with Lucide (F4)** in the four places they appear.

## Outside the catalog (reviewer judgment)

- **Duplicate sidebar entries.** "Guides › Guides" and "Reference › Reference" (`02-docs-intro-desktop.jpg`) happen
  because `docs/guides/meta.json` and `docs/reference/meta.json` list `"index"` as a child page. Remove `"index"` so
  the folder title itself links to the overview.
- **The desktop landing page doesn't fill the screen.** Content ends around 660 px of a 1092 px viewport, so the footer
  sits mid-screen with about 40% empty below (`01-landing-desktop.jpg`). Center the hero vertically
  (`min-height: calc(100dvh - nav)`) or pin the footer to the bottom.
- **The Clients table overflows at 390 px.** On `/docs/clients/` the API table needs sideways scrolling and cuts off the
  "Client" column (`07-mobile-390-landing-and-docs.jpg`). Stack the table as a definition list below `sm`, or drop the
  middle column.
- **React key warning in dev.** The dev overlay reports "Each child in a list should have a unique key" for the sidebar
  footer (`app/docs/layout.tsx:13`). It shows only in development, but it's the one runtime warning on every docs page.

## Checks verified clean

- **TYPE-1:** no centered multi-line text.
- **TYPE-2:** no uppercase buttons. The eyebrow is 11 px caps, within the allowance.
- **TYPE-3 / COL-6:** muted text measures about 7.6:1 on the page background and about 6.9:1 on card surfaces, and no
  text sits over an image.
- **BTN-1:** one primary per view. **BTN-2:** labels are verbs.
- **BTN-4, COL-4, COL-5, FORM-1–3, MODAL-1/2:** no forms, confirmation dialogs, red actions, or gradients to check.
  Search is a standard icon + placeholder pattern inside a dialog.
- **HIER-1–4:** one hero visual, one CTA pair, nav controls clustered on the right.
- **LAY-4:** no nested radii. **LAY-6:** breakpoints are deliberate (850 / 540 px).
- **IMG-3:** the logos are SVG. **MOT-1/3/4/7:** no page transitions or overlays beyond Fumadocs' defaults.
