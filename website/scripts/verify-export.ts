/** Verify the files and links that GitHub Pages will serve after a static export. */
import { resolve, relative, sep } from "node:path";

const websiteDir = resolve(import.meta.dir, "..");
const outDir = resolve(process.argv[2] ?? resolve(websiteDir, "out"));
const contentDir = resolve(websiteDir, "../docs");
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const localOrigin = "https://static-export.invalid";
const publishedOrigin = "https://bloxwap.github.io";
const publishedBasePath = "/hyperliquid";
const errors = new Set<string>();

if (basePath && (!basePath.startsWith("/") || basePath.includes("?") || basePath.includes("#"))) {
  throw new Error("NEXT_PUBLIC_BASE_PATH must be empty or an absolute URL path.");
}

const files = new Set(await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: outDir, onlyFiles: true, dot: true })));
const htmlFiles = [...files].filter((file) => file.endsWith(".html"));
if (htmlFiles.length === 0) errors.add("No HTML pages were exported.");
if (!files.has(".nojekyll")) errors.add("Missing .nojekyll: GitHub Pages must serve the Next.js assets unchanged.");

const markdownFiles: string[] = await Array.fromAsync(
  new Bun.Glob("**/*.md").scan({ cwd: contentDir, onlyFiles: true }),
);
const docsFiles = markdownFiles.filter((file) => !/(^|\/)SUMMARY\.md$/i.test(file));
if (docsFiles.length < 13) errors.add(`Expected at least 13 documentation sources, found ${docsFiles.length}.`);
for (const file of docsFiles) {
  const slug = file
    .replace(/(^|\/)README\.md$/i, "$1")
    .replace(/\.md$/i, "")
    .replace(/\/$/, "");
  const expected = `docs/${slug ? `${slug}/` : ""}index.html`;
  if (!files.has(expected)) errors.add(`${file}: missing exported page ${expected}.`);
}

type Reference = { attribute: "href" | "src"; value: string };
type Page = { ids: Set<string>; references: Reference[] };
const pages = new Map<string, Page>();
await Promise.all(
  htmlFiles.map(async (file) => {
    const page: Page = { ids: new Set(), references: [] };
    await new HTMLRewriter()
      .on("*", {
        element(element: HTMLRewriterTypes.Element): void {
          const id = element.getAttribute("id");
          if (id) page.ids.add(id);
          if (element.tagName === "a") {
            const name = element.getAttribute("name");
            if (name) page.ids.add(name);
          }
          for (const attribute of ["href", "src"] as const) {
            const value = element.getAttribute(attribute);
            if (value) page.references.push({ attribute, value });
          }
        },
      })
      .transform(new Response(Bun.file(resolve(outDir, file))))
      .text();
    pages.set(file, page);
  }),
);

function artifactFor(pathname: string): string | undefined {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  const absolute = resolve(outDir, decoded);
  // Encoded path traversal must not escape the export directory.
  if (absolute !== outDir && !absolute.startsWith(`${outDir}${sep}`)) return undefined;
  const file = relative(outDir, absolute).split(sep).join("/");
  const index = `${file ? `${file}/` : ""}index.html`;
  const candidates = pathname.endsWith("/") ? [index] : [file, index, `${file}.html`];
  return candidates.find((candidate) => files.has(candidate));
}

function stripBasePath(pathname: string, prefix: string): string | undefined {
  if (!prefix) return pathname;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return undefined;
}

let checkedLinks = 0;
let checkedAnchors = 0;
for (const [file, page] of pages) {
  const route = `/${file}`.replace(/index\.html$/, "");
  const pageUrl = new URL(`${basePath}${route}`, localOrigin);
  for (const { attribute, value } of page.references) {
    let url: URL;
    try {
      url = new URL(value, pageUrl);
    } catch {
      errors.add(`${file}: invalid ${attribute} URL ${JSON.stringify(value)}.`);
      continue;
    }
    if (url.hostname === "bloxwap.gitbook.io") {
      errors.add(`${file}: obsolete Bloxwap GitBook link ${JSON.stringify(value)}.`);
    }

    let pathname: string | undefined;
    if (url.origin === localOrigin) {
      pathname = stripBasePath(url.pathname, basePath);
      if (pathname === undefined) {
        errors.add(`${file}: ${JSON.stringify(value)} escapes the GitHub Pages base path ${basePath || "/"}.`);
        continue;
      }
    } else if (url.origin === publishedOrigin) {
      pathname = stripBasePath(url.pathname, publishedBasePath);
    }
    if (pathname === undefined) continue;
    if (/\.mdx?$/i.test(pathname)) {
      errors.add(`${file}: raw Markdown link ${JSON.stringify(value)} was not converted to a website URL.`);
      continue;
    }

    let target: string | undefined;
    try {
      target = artifactFor(pathname);
    } catch {
      errors.add(`${file}: invalid URL encoding in ${JSON.stringify(value)}.`);
      continue;
    }
    if (!target) {
      errors.add(`${file}: ${attribute} ${JSON.stringify(value)} does not resolve to an exported file.`);
      continue;
    }
    checkedLinks++;

    // Empty fragments and #top are browser navigation controls. Text fragments
    // may follow a normal anchor, but do not themselves name an HTML element.
    const fragment = url.hash.slice(1).split(":~:")[0];
    if (attribute !== "href" || !fragment || fragment.toLowerCase() === "top" || !pages.has(target)) continue;
    let anchor: string;
    try {
      anchor = decodeURIComponent(fragment);
    } catch {
      errors.add(`${file}: invalid fragment encoding in ${JSON.stringify(value)}.`);
      continue;
    }
    if (!pages.get(target)?.ids.has(anchor)) {
      errors.add(`${file}: ${JSON.stringify(value)} points to missing anchor #${anchor} in ${target}.`);
    } else {
      checkedAnchors++;
    }
  }
}

// The search endpoint is exported as JSON, so search needs no server on Pages.
const searchArtifact = artifactFor("/search-index.json");
if (!searchArtifact) {
  errors.add("Missing statically exported search index at /search-index.json.");
} else {
  try {
    const searchIndex: unknown = await Bun.file(resolve(outDir, searchArtifact)).json();
    if (!searchIndex || typeof searchIndex !== "object" || Object.keys(searchIndex).length === 0) {
      errors.add("The static search index is empty.");
    }
  } catch {
    errors.add(`${searchArtifact}: static search index is not valid JSON.`);
  }
}

if (errors.size > 0) {
  console.error(`Static export verification failed (${errors.size} issue${errors.size === 1 ? "" : "s"}):`);
  for (const error of [...errors].sort().slice(0, 60)) console.error(`- ${error}`);
  if (errors.size > 60) console.error(`- ...and ${errors.size - 60} more issues.`);
  process.exit(1);
}

console.log(
  `Verified ${docsFiles.length} docs pages, ${htmlFiles.length} HTML files, ${checkedLinks} internal links/assets, ` +
    `${checkedAnchors} anchors, static search, and .nojekyll (base path: ${basePath || "/"}).`,
);
