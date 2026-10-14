import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: { baseURL: "http://127.0.0.1:4173", reducedMotion: "reduce" },
  webServer: {
    command: "bun run preview",
    url: "http://127.0.0.1:4173/hyperliquid/",
    env: { NEXT_PUBLIC_BASE_PATH: "/hyperliquid" },
    reuseExistingServer: false,
  },
});
