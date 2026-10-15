"use client";

import { HIGProvider } from "@bloxwap/hig-react/provider";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import SearchDialog from "./search";

/**
 * Fumadocs keeps routing, search and theme; HIGProvider supplies comfortable density and follows the OS
 * reduced-motion setting. No feedback sink is passed, so HIG controls stay silent on this documentation site.
 */
export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ forcedTheme: "dark" }} search={{ SearchDialog }}>
      <HIGProvider density="comfortable" locale="en">
        {children}
      </HIGProvider>
    </RootProvider>
  );
}
