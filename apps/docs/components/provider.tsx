"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import SearchDialog from "./search";

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ forcedTheme: "dark" }} search={{ SearchDialog }}>
      {children}
    </RootProvider>
  );
}
