// Measures the static export and docs sources for the HIG migration evidence.
// Usage (after `NEXT_PUBLIC_BASE_PATH=/hyperliquid bun run build`): node apps/docs/scripts/measure-hig.mjs . <label>
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
const [root, label] = process.argv.slice(2);
const docs = join(root, "apps/docs");
const out = join(docs, "out");
function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
}
const files = walk(out);
const sum = (fs) => fs.reduce((a, f) => a + statSync(f).size, 0);
const gz = (fs) => fs.reduce((a, f) => a + gzipSync(readFileSync(f)).length, 0);
const css = files.filter((f) => f.endsWith(".css"));
const js = files.filter((f) => f.endsWith(".js"));
const fonts = files.filter((f) => /\.(woff2?|ttf|otf)$/.test(f));
// CSS actually linked by the home page (initial load)
const home = readFileSync(join(out, "index.html"), "utf8");
const linked = [...home.matchAll(/href="\/hyperliquid(\/_next\/static\/[^"]+\.css)"/g)].map((m) => join(out, m[1]));
const homeJs = [
  ...new Set([...home.matchAll(/src="\/hyperliquid(\/_next\/static\/[^"]+\.js)"/g)].map((m) => join(out, m[1]))),
];
import { execFileSync } from "node:child_process";
// Tracked docs app files (git), excluding content, evidence images and public assets.
const srcFiles = execFileSync("git", ["ls-files", "apps/docs"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !/^apps\/docs\/(design-review|content|public)\//.test(f))
  .map((f) => join(root, f))
  .filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
const publicFonts = execFileSync("git", ["ls-files", "apps/docs/public/fonts", "apps/docs/vendor"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const lock = readFileSync(join(root, "bun.lock"), "utf8");
const lockPkgs = (lock.match(/^ {4}"[^"]+": \[/gm) || []).length;
const pkg = JSON.parse(readFileSync(join(docs, "package.json"), "utf8"));
const globalCss = readFileSync(join(docs, "app/global.css"), "utf8");
const result = {
  label,
  exportTotalBytes: sum(files),
  exportFiles: files.length,
  cssFiles: css.length,
  cssBytes: sum(css),
  cssGzip: gz(css),
  homeLinkedCssBytes: sum(linked),
  homeLinkedCssGzip: gz(linked),
  jsBytes: sum(js),
  jsGzip: gz(js),
  homeInitialJsBytes: sum(homeJs),
  homeInitialJsGzip: gz(homeJs),
  fontBytes: sum(fonts),
  fontFiles: fonts.map((f) => relative(out, f)).length,
  docsDirectDependencies: Object.keys(pkg.dependencies || {}).length,
  docsDirectDevDependencies: Object.keys(pkg.devDependencies || {}).length,
  bunLockPackages: lockPkgs,
  globalCssLines: globalCss.split("\n").length,
  globalCssBytes: Buffer.byteLength(globalCss),
  docsSourceFiles: srcFiles.length,
  docsSourceBytes: sum(srcFiles),
  copiedFontAndCssFiles: publicFonts.length,
};
console.log(JSON.stringify(result, null, 2));
