import { defineConfig } from "@playwright/test";

// PORT lets parallel local runs avoid the default preview port; CI keeps 4173.
const port = Number(process.env.PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, reducedMotion: "reduce" },
  webServer: {
    command: "bun run preview",
    url: `http://127.0.0.1:${port}/hyperliquid/`,
    env: { NEXT_PUBLIC_BASE_PATH: "/hyperliquid", PORT: String(port) },
    reuseExistingServer: false,
  },
});
