// Paired production-export proof; static HTTP only, no SDK/signing calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "@playwright/test";
const [phase, source] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const root = path.resolve(import.meta.dirname, "../../..");
const out = path.join(root, "apps/docs/design-review/callout-refresh");
await mkdir(out, { recursive: true });
const sourceRoot = path.resolve(root, source);
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain",
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith("/hyperliquid/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  const target = path.resolve(
    sourceRoot,
    "." +
      decodeURIComponent(url.pathname.slice("/hyperliquid".length)) +
      (url.pathname.endsWith("/") ? "index.html" : ""),
  );
  if (!target.startsWith(sourceRoot + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const body = await readFile(target);
    response.writeHead(200, { "content-type": types[path.extname(target)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { checkedAt: new Date().toISOString(), phase, passed: false, cases: [] };
let browser;
try {
  for (const engine of ["chromium", "webkit"]) {
    browser = await { chromium, webkit }[engine].launch({ headless: true });
    for (const width of [390, 1440])
      for (const scale of [100, 200]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
        try {
          const page = await context.newPage(),
            errors = [],
            outbound = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.route("**/*", (route) => {
            if (
              !route
                .request()
                .url()
                .startsWith(origin + "/") ||
              route.request().method() !== "GET"
            ) {
              outbound.push(route.request().url());
              return route.abort();
            }
            return route.continue();
          });
          await page.goto(`${origin}/hyperliquid/docs/utilities/`);
          await page.evaluate(async (scale) => {
            document.documentElement.style.fontSize = `${scale}%`;
            await document.fonts.ready;
          }, scale);
          const result = await page.evaluate(() => ({
            text: document.querySelector("main")?.textContent,
            overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
            callouts: [...document.querySelectorAll(".docs-callout")].map((box) => {
              const node = box.querySelector(".hig-surface"),
                style = getComputedStyle(node),
                rect = node.getBoundingClientRect();
              return {
                type: box.dataset.type,
                severity: node.dataset.severity,
                text: node.textContent,
                role: node.getAttribute("role"),
                live: node.getAttribute("aria-live"),
                width: rect.width,
                height: rect.height,
                font: style.fontFamily,
                size: style.fontSize,
                lineHeight: style.lineHeight,
                edge: style.borderInlineStartWidth,
                edgeStyle: style.borderInlineStartStyle,
                edgeColor: style.borderInlineStartColor,
              };
            }),
          }));
          assert.ok(result.callouts.length > 0);
          for (const callout of result.callouts) {
            const severities =
              phase === "before"
                ? { note: "info", tip: "success", important: "info", warning: "warning", caution: "error" }
                : { note: "note", tip: "tip", important: "info", warning: "warning", caution: "error" };
            assert.equal(callout.severity, severities[callout.type]);
            assert.equal(callout.role, null);
            assert.equal(callout.live, null);
            assert.equal(callout.edge, "3px");
            assert.equal(callout.edgeStyle, "solid");
          }
          assert.deepEqual(errors, []);
          assert.deepEqual(outbound, []);
          const screenshot = `${phase}-${engine}-${width}-${scale}.jpg`;
          await page.locator(".docs-callout").first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(out, screenshot), type: "jpeg", quality: 75 });
          const key = `${engine}/${width}/${scale}`;
          if (phase === "after") {
            const before = JSON.parse(await readFile(path.join(out, "before-browser.json"), "utf8")).cases.find(
              (item) => item.key === key,
            );
            assert.equal(result.text, before.text);
            assert.ok(result.overflow <= before.overflow, "refresh must not add overflow");
            assert.deepEqual(
              result.callouts.map(({ severity, ...rest }) => rest),
              before.callouts.map(({ severity, ...rest }) => rest),
              "visible callout content, geometry, font and semantic edge remain unchanged",
            );
          }
          report.cases.push({ key, engine, width, scale, ...result, pageErrors: errors, outbound, screenshot });
          console.log(`${phase} ${key}: ${result.callouts.length} static callouts passed`);
        } finally {
          await context.close();
        }
      }
    await browser.close();
    browser = undefined;
  }
  report.passed = true;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(out, `${phase}-browser.json`), JSON.stringify(report, null, 2) + "\n");
}
