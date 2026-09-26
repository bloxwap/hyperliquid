import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { socialImageSize } from "@/lib/social";

const assets = Promise.all([
  readFile(join(process.cwd(), "public/fonts/SpaceGrotesk-Bold.ttf")),
  readFile(join(process.cwd(), "public/fonts/Nunito-Bold.ttf")),
  readFile(join(process.cwd(), "public/logos/bloxwap-icon-green.svg")),
]);

type Card = { title: string; description: string; section: string; home?: boolean };

/** Rendered at build time; GitHub Pages serves the resulting PNG without a server. */
export async function createSocialImage({ title, description, section, home = false }: Card) {
  const [displayFont, bodyFont, icon] = await assets;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#0a0a0a",
        color: "#ffffff",
        borderLeft: "24px solid #00ff3f",
        padding: "48px 64px 42px",
        fontFamily: "Nunito",
        fontWeight: 700,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* ImageResponse embeds the original SVG; this is not a browser image. */}
          {/* biome-ignore lint/performance/noImgElement: ImageResponse requires an img element. */}
          <img src={`data:image/svg+xml;base64,${icon.toString("base64")}`} width={52} height={52} alt="Bloxwap" />
          <span style={{ fontFamily: "Space Grotesk", fontSize: 28 }}>Hyperliquid SDK</span>
        </div>
        <span style={{ color: "#a3a3a3", fontSize: 22 }}>Built by Bloxwap</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div style={{ color: "#00ff3f", fontSize: 18, letterSpacing: 3, marginBottom: 20 }}>{section}</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Space Grotesk",
            fontSize: home ? 86 : title.length > 38 ? 62 : 76,
            lineHeight: 1.05,
            letterSpacing: -3,
            maxWidth: 1016,
          }}
        >
          {home ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span>Build on</span>
              <span style={{ color: "#00ff3f" }}>Hyperliquid.</span>
            </div>
          ) : (
            title
          )}
        </div>
        <div style={{ color: "#a3a3a3", fontSize: 28, lineHeight: 1.4, marginTop: 24, maxWidth: 980 }}>
          {description}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: "1px solid #292929",
          paddingTop: 22,
          fontSize: 20,
          color: "#a3a3a3",
        }}
      >
        <span>@bloxwap/hyperliquid</span>
        <span>TypeScript & JavaScript</span>
      </div>
    </div>,
    {
      ...socialImageSize,
      fonts: [
        { name: "Space Grotesk", data: displayFont, weight: 700, style: "normal" },
        { name: "Nunito", data: bodyFont, weight: 700, style: "normal" },
      ],
    },
  );
}
