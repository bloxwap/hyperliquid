import type { Metadata } from "next";

export const siteUrl = new URL("https://bloxwap.github.io/hyperliquid/");
export const socialImageSize = { width: 1200, height: 630 };
export const homeDescription =
  "A fast, typed Hyperliquid SDK for TypeScript and JavaScript. Connect, trade, and subscribe with Bloxwap.";

export function socialImagePath(pageUrl: string) {
  return `/og/${pageUrl.replace(/^\/+|\/+$/g, "") || "index"}.png`;
}

export function socialMetadata(pageUrl: string, title: string, description: string): Metadata {
  // Canonicals describe the published site even when previewing without a base path.
  const path = pageUrl.replace(/^\/+|\/+$/g, "");
  const canonical = new URL(path ? `${path}/` : "", siteUrl).href;
  const url = new URL(socialImagePath(pageUrl).slice(1), siteUrl).href;
  const alt = `${title} — Bloxwap documentation`;

  return {
    description,
    // Point agents at the plain-text index of the whole site from every page.
    alternates: { canonical, types: { "text/plain": new URL("llms.txt", siteUrl).href } },
    openGraph: {
      type: "website",
      siteName: "Bloxwap",
      locale: "en_US",
      url: canonical,
      title,
      description,
      images: [{ url, ...socialImageSize, type: "image/png", alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url, alt }],
    },
  };
}
