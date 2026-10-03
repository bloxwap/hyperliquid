import localFont from "next/font/local";

export { BloxwapSans as sans } from "@bloxwap/font/sans";
export { BloxwapMono as mono } from "@bloxwap/font/mono";

export const display = localFont({
  src: "../public/fonts/SpaceGrotesk-Bold.ttf",
  weight: "700",
  variable: "--font-docs-display",
  display: "swap",
});
