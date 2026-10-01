/**
 * Export agent-readable Markdown to the static site: a `.md` mirror for every documentation
 * page (GitHub Pages serves them as text/markdown). Runs after
 * `next build` so verify-export.ts can check the results alongside everything else.
 */
import { resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..");
const outDir = resolve(process.argv[2] ?? resolve(appDir, "out"));
const contentDir = resolve(appDir, "content/docs");

// The page order follows the root meta.json; nested pages sort after their folder index.
const meta: { pages?: string[] } = await Bun.file(resolve(contentDir, "meta.json")).json();
const topLevelOrder = new Map((meta.pages ?? []).map((name, index) => [name, index]));

const files = (await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: contentDir, onlyFiles: true })))
  .filter((file) => !/(^|\/)SUMMARY\.md$/i.test(file))
  .sort((a, b) => {
    const slugA = a
      .replace(/(^|\/)README\.md$/i, "$1")
      .replace(/\.md$/i, "")
      .replace(/\/$/, "");
    const slugB = b
      .replace(/(^|\/)README\.md$/i, "$1")
      .replace(/\.md$/i, "")
      .replace(/\/$/, "");
    const rank = (slug: string) => topLevelOrder.get(slug.split("/")[0] || "index") ?? topLevelOrder.size;
    return rank(slugA) - rank(slugB) || slugA.localeCompare(slugB);
  });

for (const file of files) {
  const slug = file
    .replace(/(^|\/)README\.md$/i, "$1")
    .replace(/\.md$/i, "")
    .replace(/\/$/, "");
  const markdown = await Bun.file(resolve(contentDir, file)).text();
  const mirror = slug ? `docs/${slug}.md` : "docs.md";
  await Bun.write(resolve(outDir, mirror), markdown);
}

console.log(`Exported ${files.length} Markdown mirrors.`);
