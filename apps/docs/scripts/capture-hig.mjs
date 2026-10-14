import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
for (const [name, path] of [
  ["home", ""],
  ["clients", "docs/clients/"],
]) {
  await page.goto("http://127.0.0.1:4173/hyperliquid/" + path);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `apps/docs/design-review/hig/${process.argv[2]}-${name}.png`, fullPage: true });
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:4173/hyperliquid/docs/clients/");
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `apps/docs/design-review/hig/${process.argv[2]}-mobile.png`, fullPage: true });
await browser.close();
