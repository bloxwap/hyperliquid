import localFont from "next/font/local";

// The same self-hosted font families as the Bloxwap monorepo's docs.
// SIL OFL notices are distributed alongside the binaries in public/fonts.
export const nunito = localFont({
  src: "../public/fonts/Nunito-latin.woff2",
  weight: "200 1000",
  variable: "--font-docs-sans",
  display: "swap",
});

export const display = localFont({
  src: "../public/fonts/SpaceGrotesk-Bold.ttf",
  weight: "700",
  variable: "--font-docs-display",
  display: "swap",
});

export const maple = localFont({
  src: "../public/fonts/MapleMono.woff2",
  weight: "100 800",
  variable: "--font-docs-mono",
  display: "swap",
});
