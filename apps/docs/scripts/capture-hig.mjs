// Captures the HIG migration evidence screenshots from a running static preview.
// Usage: PORT=4173 bun run preview & PORT=4173 node scripts/capture-hig.mjs <before|after>
// The playground shots use deterministic, mocked WebSocket frames so before/after are comparable.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const label = process.argv[2] ?? "after";
const origin = `http://127.0.0.1:${process.env.PORT ?? 4173}/hyperliquid/`;
const outDir = new URL(`../design-review/hig-packages/${label}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });

const viewports = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
};

async function mockMarket(page) {
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === "subscribe") {
        socket.send(JSON.stringify({ channel: "subscriptionResponse", data: message }));
        socket.send(
          JSON.stringify({
            channel: "l2Book",
            data: {
              coin: "BTC",
              time: 1760400000000,
              levels: [[{ px: "65000.0", sz: "1.25", n: 4 }], [{ px: "65001.0", sz: "0.80", n: 3 }]],
            },
          }),
        );
      }
    });
  });
}

const browser = await chromium.launch({ headless: true });
for (const [viewportName, viewport] of Object.entries(viewports)) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await context.newPage();
  await mockMarket(page);
  const shot = async (name, options = {}) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: new URL(`${viewportName}-${name}.jpg`, outDir).pathname,
      type: "jpeg",
      quality: 70,
      ...options,
    });
  };

  await page.goto(origin);
  await shot("home", { fullPage: true });

  await page.getByRole("button", { name: "Order book", exact: true }).click();
  await page.locator('.playground-status[data-status="live"]').waitFor();
  await page.locator(".playground-json").waitFor();
  await page.locator("#playground").scrollIntoViewIfNeeded();
  await page.locator("#playground").screenshot({
    path: new URL(`${viewportName}-playground.jpg`, outDir).pathname,
    type: "jpeg",
    quality: 70,
  });

  for (const [name, path] of [
    ["docs-intro", "docs/"],
    ["docs-clients", "docs/clients/"],
  ]) {
    await page.goto(origin + path);
    await shot(name);
  }

  // Before the migration GitHub alerts were plain blockquotes; after, HIG callouts.
  await page.goto(`${origin}docs/utilities/`);
  await page.locator(".docs-callout, #nd-page blockquote").first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await shot("docs-utilities-callouts");

  await page.goto(`${origin}docs/clients/`);
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").locator("input").fill("transport");
  await page.getByRole("dialog").getByRole("option").first().waitFor();
  await shot("search-results");
  await page.getByRole("dialog").locator("input").fill("zzzzdoesnotexistzzzz");
  await page.getByText("No matches", { exact: false }).waitFor();
  await shot("search-empty");
  await page.keyboard.press("Escape");

  if (viewportName === "mobile") {
    await page.getByRole("button", { name: "Open Sidebar" }).click();
    await page.getByRole("link", { name: "Connect to Hyperliquid", exact: true }).last().waitFor();
    await shot("nav-open");
  }
  await context.close();
}
await browser.close();
console.log(`Saved ${label} screenshots to ${outDir.pathname}`);
