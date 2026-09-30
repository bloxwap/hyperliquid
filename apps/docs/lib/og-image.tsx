import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ExchangeClient } from "@bloxwap/hyperliquid/api/exchange/client";
import { InfoClient } from "@bloxwap/hyperliquid/api/info/client";
import { SubscriptionClient } from "@bloxwap/hyperliquid/api/subscription/client";
import { ImageResponse } from "next/og";
import { BRAND_GREEN, BRAND_ICON } from "@/lib/brand";
import { socialImageSize } from "@/lib/social";

// Modeled on GitHub's repository cards in dark mode, matching the chart and sfx docs cards: the site's black
// canvas, an owner/repo title, a muted description, the logo tile top right, a stats row, and the Bloxwap
// brand palette as the color bar along the bottom. Colors are sRGB hex for the Satori/resvg renderer.
const BRAND = {
  black: "#0A0A0A",
  ink: "#F5F7FA",
  muted: "#A1A1A1",
};

/** The brand palette weighted like a GitHub language bar, green leading. */
const BAR: [color: string, share: number][] = [
  [BRAND_GREEN, 62],
  ["#35B5FF", 14],
  ["#B300FF", 10],
  ["#FF479C", 8],
  ["#FFFB38", 6],
];

const assets = Promise.all([
  readFile(join(process.cwd(), "public/fonts/Nunito-Bold.ttf")),
  readFile(join(process.cwd(), "public/fonts/Nunito-Black.ttf")),
  readFile(join(process.cwd(), "../../packages/hyperliquid/package.json"), "utf8"),
]);

/** Lucide 24px stroke icons, inlined so the renderer needs no icon font or component. */
const ICONS = {
  info: ["m21 21-4.34-4.34", "M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0"],
  exchange: ["M8 3 4 7l4 4", "M4 7h16", "m16 21 4-4-4-4", "M20 17H4"],
  subscription: [
    "M16.247 7.761a6 6 0 0 1 0 8.478",
    "M19.075 4.933a10 10 0 0 1 0 14.134",
    "M4.925 19.067a10 10 0 0 1 0-14.134",
    "M7.753 16.239a6 6 0 0 1 0-8.478",
    "M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  ],
  version: [
    "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
    "M7.5 7.5h.01",
  ],
  docs: ["M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"],
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={name}
      fill="none"
      stroke={BRAND.muted}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Public methods on a client: one per Info query, Exchange action, or subscription. */
function methodCount(client: { prototype: object }): number {
  return Object.getOwnPropertyNames(client.prototype).filter((name) => name !== "constructor").length;
}

/** Clamp by code point so a surrogate pair is never split. */
function clamp(text: string, max: number): string {
  const points = [...text.trim()];
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : points.join("");
}

type Card = {
  title: string;
  description: string;
  /** Page section after "bloxwap/hyperliquid ·" on docs cards, e.g. "Guides". */
  category: string;
  /** The landing card: the owner/repo title and the stats row. */
  home?: boolean;
};

/** Rendered at build time; GitHub Pages serves the resulting PNG without a server. */
export async function createSocialImage({ title, description, category, home = false }: Card) {
  const [bold, black, manifest] = await assets;
  const { version } = JSON.parse(manifest) as { version: string };
  const stats: [icon: keyof typeof ICONS, value: string, label: string][] = [
    ["info", String(methodCount(InfoClient)), "Info queries"],
    ["exchange", String(methodCount(ExchangeClient)), "Exchange actions"],
    ["subscription", String(methodCount(SubscriptionClient)), "Subscriptions"],
    ["version", `v${version}`, "Latest"],
  ];
  const headline = clamp(title, 60);
  const fontSize = home ? 72 : headline.length <= 20 ? 84 : headline.length <= 34 ? 72 : 60;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: BRAND.black,
        color: BRAND.ink,
        fontFamily: "Nunito",
      }}
    >
      <div style={{ display: "flex", flex: 1, padding: "76px 80px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 64 }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize, lineHeight: 1.12, letterSpacing: -1 }}>
            {home ? (
              <>
                <span style={{ fontWeight: 700, color: BRAND.muted }}>bloxwap/</span>
                <span style={{ fontWeight: 900 }}>hyperliquid</span>
              </>
            ) : (
              <span style={{ fontWeight: 900 }}>{headline}</span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 34,
              fontWeight: 700,
              lineHeight: 1.4,
              color: BRAND.muted,
            }}
          >
            {clamp(description, 150)}
          </div>
        </div>
        <svg
          width={200}
          height={200}
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
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 56, padding: "0 80px 52px" }}>
        {home ? (
          stats.map(([icon, value, label]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, fontWeight: 700 }}>
                <Icon name={icon} />
                {value}
              </div>
              <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: BRAND.muted }}>{label}</div>
            </div>
          ))
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 30,
              fontWeight: 700,
              color: BRAND.muted,
            }}
          >
            <Icon name="docs" />
            <span style={{ color: BRAND.ink }}>bloxwap/hyperliquid</span>
            <span>·</span>
            <span>{category}</span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", height: 24 }}>
        {BAR.map(([color, share]) => (
          <div key={color} style={{ display: "flex", flex: share, background: color }} />
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
