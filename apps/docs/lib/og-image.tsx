import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_GREEN, BRAND_WORDMARK, BRAND_X } from "@/lib/brand";
import { socialImageSize } from "@/lib/social";

// The Bloxwap social card, ported from monorepo/packages/og (og-card.tsx and brand-mark.tsx) and
// laid out like the @bloxwap/chart docs cards: the drawn wordmark with a "· HYPERLIQUID" product
// label, a category top right, a 24px accent rail, and a Nunito Black headline anchored above the
// description. Colors are sRGB hex for the Satori/resvg renderer.
const BRAND = {
  black: "#0A0A0A",
  text: "#F5F7FA",
  muted: "rgba(245,247,250,0.62)",
  dot: "rgba(245,247,250,0.28)",
  category: "#A1A1A1",
};

/** Accent palette in the monorepo's order; the seeded hash below indexes it. */
const ACCENT_PALETTE = [BRAND_GREEN, "#35B5FF", "#B300FF", "#FF479C", "#FFFB38"] as const;

const assets = Promise.all([
  readFile(join(process.cwd(), "public/fonts/Nunito-Bold.ttf")),
  readFile(join(process.cwd(), "public/fonts/Nunito-Black.ttf")),
  readFile(join(process.cwd(), "public/fonts/SpaceGrotesk-Bold.ttf")),
]);

/** Deterministic FNV-1a, as monorepo/packages/og/src/accent.ts: a page keeps its color. */
function accentFor(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193);
  return ACCENT_PALETTE[(hash >>> 0) % ACCENT_PALETTE.length];
}

/** Headline size, tracking and leading step down as the title grows (monorepo HEADLINE_TIERS). */
const HEADLINE_TIERS = [
  { max: 14, size: 148, tracking: -5, line: 0.94 },
  { max: 28, size: 116, tracking: -4, line: 0.95 },
  { max: 46, size: 92, tracking: -3, line: 0.96 },
  { max: 66, size: 72, tracking: -2, line: 0.98 },
  { max: Number.POSITIVE_INFINITY, size: 58, tracking: -1.5, line: 1 },
] as const;

/** Clamp by code point so a surrogate pair is never split. */
function clamp(text: string, max: number): string {
  const points = [...text.trim()];
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : points.join("");
}

// Wordmark ink bounds in viewBox units: the "B" stem starts at 14.2, the "p" bowl ends at 803.2.
const WORDMARK_INK = { left: 14.2, right: 803.2 };

/**
 * The drawn wordmark laid out on its letters (cap top to baseline, "B" stem to "p"), so flex
 * alignment measures against the visible type. Ascender, overshoots and descender draw outside.
 */
function Wordmark({ capHeight }: { capHeight: number }) {
  const scale = capHeight / BRAND_WORDMARK.capHeight;
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        flexShrink: 0,
        width: (WORDMARK_INK.right - WORDMARK_INK.left) * scale,
        height: capHeight,
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: -WORDMARK_INK.left * scale,
          top: -(BRAND_WORDMARK.baseline - BRAND_WORDMARK.capHeight) * scale,
        }}
      >
        <svg
          width={BRAND_WORDMARK.width * scale}
          height={BRAND_WORDMARK.height * scale}
          viewBox={BRAND_WORDMARK.viewBox}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Bloxwap"
        >
          <path d={BRAND_WORDMARK.letters} fill={BRAND.text} />
          <g transform={BRAND_WORDMARK.xTransform}>
            <g fill="none" stroke={BRAND_GREEN} strokeWidth={BRAND_X.strokeWidth} strokeLinecap="round">
              {BRAND_X.paths.map((d) => (
                <path key={d} d={d} />
              ))}
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}

type Card = {
  title: string;
  description: string;
  /** Top-right category, e.g. "GUIDES". */
  category: string;
  /** The landing card: green accent and the two-line landing headline. */
  home?: boolean;
};

/** Rendered at build time; GitHub Pages serves the resulting PNG without a server. */
export async function createSocialImage({ title, description, category, home = false }: Card) {
  const [bold, black, display] = await assets;
  const headline = clamp(title, 90);
  const tier = HEADLINE_TIERS.find((t) => headline.length <= t.max) ?? HEADLINE_TIERS[HEADLINE_TIERS.length - 1];
  const accent = home ? BRAND_GREEN : accentFor(headline);
  const body = clamp(description, 180);

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
        background: BRAND.black,
        color: BRAND.text,
        fontFamily: "Nunito",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: 24,
          height: "100%",
          background: accent,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "62px 72px 54px 78px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          {/* Eyebrow: the Space Grotesk caps sit on the wordmark's baseline (monorepo BrandEyebrow). */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
            <Wordmark capHeight={26} />
            <div
              style={{
                display: "flex",
                gap: 14,
                fontFamily: "Space Grotesk",
                fontSize: 26,
                lineHeight: 1,
                marginBottom: -4,
              }}
            >
              <span style={{ display: "flex", color: BRAND.dot }}>·</span>
              <span style={{ display: "flex", color: accent, letterSpacing: 6 }}>HYPERLIQUID</span>
            </div>
          </div>
          <span
            style={{
              display: "flex",
              fontFamily: "Space Grotesk",
              fontSize: 18,
              lineHeight: 1,
              letterSpacing: 3,
              color: BRAND.category,
            }}
          >
            {category}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "flex-end" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              maxWidth: 1040,
              fontSize: home ? 116 : tier.size,
              fontWeight: 900,
              letterSpacing: home ? -4 : tier.tracking,
              lineHeight: home ? 0.95 : tier.line,
            }}
          >
            {/* Satori lays out a fragment's children on one row, so the home lines are separate divs. */}
            {home
              ? ["Build on", "Hyperliquid."].map((line) => (
                  <div key={line} style={{ display: "flex" }}>
                    {line}
                  </div>
                ))
              : headline}
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 960,
              marginTop: 34,
              fontSize: 28,
              fontWeight: 700,
              lineHeight: 1.3,
              color: BRAND.muted,
            }}
          >
            {body}
          </div>
        </div>
      </div>
    </div>,
    {
      ...socialImageSize,
      fonts: [
        { name: "Nunito", data: bold, weight: 700, style: "normal" },
        { name: "Nunito", data: black, weight: 900, style: "normal" },
        { name: "Space Grotesk", data: display, weight: 700, style: "normal" },
      ],
    },
  );
}
