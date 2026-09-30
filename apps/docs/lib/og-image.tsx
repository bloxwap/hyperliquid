import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_GREEN, BRAND_ICON, BRAND_WORDMARK, BRAND_X } from "@/lib/brand";
import { socialImageSize } from "@/lib/social";

// The Bloxwap social card, laid out like a GitHub repository card: a "prefix/title" path headline
// and description on the left, the app icon as the avatar top right, a row of facts with the
// wordmark bottom right, and the brand palette as the language bar along the bottom edge.
// Colors are sRGB hex for the Satori/resvg renderer.
const BRAND = {
  black: "#0A0A0A",
  text: "#F5F7FA",
  muted: "rgba(245,247,250,0.62)",
};

/** The brand palette in the monorepo's order, drawn as equal segments of the bottom bar. */
const PALETTE = [BRAND_GREEN, "#35B5FF", "#B300FF", "#FF479C", "#FFFB38"] as const;

const assets = Promise.all([
  readFile(join(process.cwd(), "public/fonts/Nunito-Bold.ttf")),
  readFile(join(process.cwd(), "public/fonts/Nunito-Black.ttf")),
]);

/** Headline size and leading step down as the title grows; the path prefix counts toward it. */
const HEADLINE_TIERS = [
  { max: 24, size: 76, line: 1.08 },
  { max: 44, size: 64, line: 1.1 },
  { max: Number.POSITIVE_INFINITY, size: 54, line: 1.12 },
] as const;

/** Lucide icon paths (24px grid, 2px round strokes) for the facts row. */
const ICONS = {
  code: ["m18 16 4-4-4-4", "m6 8-4 4 4 4", "m14.5 4-5 16"],
  scale: [
    "M12 3v18",
    "m19 8 3 8a5 5 0 0 1-6 0zV7",
    "M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1",
    "m5 8 3 8a5 5 0 0 1-6 0zV7",
    "M7 21h10",
  ],
} as const;

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

/** The app icon (bloxwap-icon-green.svg) in the avatar slot. */
function AppIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={BRAND_ICON.viewBox}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Bloxwap"
    >
      <rect width="100" height="100" rx={BRAND_ICON.radius} fill={BRAND_GREEN} />
      <g fill="none" stroke={BRAND.black} strokeWidth={BRAND_ICON.strokeWidth} strokeLinecap="round">
        {BRAND_ICON.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

function Fact({ icon, label }: { icon: keyof typeof ICONS; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width={30} height={30} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={icon}>
        <g fill="none" stroke={BRAND.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon].map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      <span style={{ display: "flex" }}>{label}</span>
    </div>
  );
}

type Card = {
  /** Muted path segment before the slash, e.g. "bloxwap" or "guides". */
  prefix: string;
  title: string;
  description: string;
};

/** Rendered at build time; GitHub Pages serves the resulting PNG without a server. */
export async function createSocialImage({ prefix, title, description }: Card) {
  const [bold, black] = await assets;
  const headline = clamp(title, 72);
  const tier =
    HEADLINE_TIERS.find((t) => prefix.length + 1 + headline.length <= t.max) ??
    HEADLINE_TIERS[HEADLINE_TIERS.length - 1];
  // Satori wraps flex items, not text runs, so each word is its own item after the prefix.
  const words = headline.split(/\s+/);

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: BRAND.black,
        color: BRAND.text,
        fontFamily: "Nunito",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: "80px 80px 56px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 64 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                fontSize: tier.size,
                lineHeight: tier.line,
                letterSpacing: -1,
              }}
            >
              <span style={{ display: "flex", fontWeight: 700, color: BRAND.muted }}>{prefix}/</span>
              {words.map((word, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: a title may repeat a word.
                  key={i}
                  style={{
                    display: "flex",
                    fontWeight: 900,
                    marginRight: i < words.length - 1 ? tier.size * 0.26 : 0,
                  }}
                >
                  {word}
                </span>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1.35,
                color: BRAND.muted,
              }}
            >
              {clamp(description, 150)}
            </div>
          </div>
          <AppIcon size={168} />
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 44, fontSize: 26, fontWeight: 700 }}>
            <Fact icon="code" label="TypeScript" />
            <Fact icon="scale" label="MIT license" />
          </div>
          <Wordmark capHeight={30} />
        </div>
      </div>
      <div style={{ display: "flex", height: 16 }}>
        {PALETTE.map((color) => (
          <div key={color} style={{ display: "flex", flex: 1, background: color }} />
        ))}
      </div>
    </div>,
    {
      ...socialImageSize,
      fonts: [
        { name: "Nunito", data: bold, weight: 700, style: "normal" },
        { name: "Nunito", data: black, weight: 900, style: "normal" },
      ],
    },
  );
}
