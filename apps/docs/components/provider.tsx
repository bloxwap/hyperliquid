"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import { lazy, type ReactNode } from "react";

const SearchDialog = lazy(() => import("./search"));

/**
 * The docs are dark-only by brand decision, not by omission: Bloxwap's identity is built on neon
 * accents over near-black, and the generated brand tokens in app/brand-tokens.css exist in that
 * mode only. Offering light mode would first need light values from the brand source; the semantic
 * color layer in app/global.css is where they would go, with no component changes.
 */
export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ forcedTheme: "dark" }} search={{ SearchDialog, preload: false }}>
      {children}
    </RootProvider>
  );
}
