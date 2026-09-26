import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import { display, maple, nunito } from "@/lib/fonts";
import "./global.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bloxwap.github.io/hyperliquid/"),
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logos/bloxwap-symbol.svg` },
  title: { default: "Hyperliquid SDK · Bloxwap", template: "%s · Hyperliquid SDK" },
  description:
    "A fast, typed Hyperliquid SDK for TypeScript and JavaScript. Connect, trade, and subscribe with Bloxwap.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${nunito.variable} ${maple.variable} ${display.variable} dark`}
      suppressHydrationWarning
    >
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
