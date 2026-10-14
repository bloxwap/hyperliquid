"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import SearchDialog from "./search";

/** HIG dark shell; feedback remains muted and the OS reduced-motion setting is respected. */
export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ forcedTheme: "dark" }} search={{ SearchDialog }}>
      <div className="hig-shell" data-hig-density="comfortable">
        {children}
      </div>
    </RootProvider>
  );
}
