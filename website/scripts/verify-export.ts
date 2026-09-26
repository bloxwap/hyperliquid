/** Verify the files and links that GitHub Pages will serve after a static export. */
import { createHash } from "node:crypto";
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
const contentPages = new Map<string, string>([["index.html", "/"]]);
if (docsFiles.length < 13) errors.add(`Expected at least 13 documentation sources, found ${docsFiles.length}.`);
for (const file of docsFiles) {
  const slug = file
    .replace(/(^|\/)README\.md$/i, "$1")
    .replace(/\.md$/i, "")
    .replace(/\/$/, "");
  const expected = `docs/${slug ? `${slug}/` : ""}index.html`;
  contentPages.set(expected, `/docs/${slug ? `${slug}/` : ""}`);
  if (!files.has(expected)) errors.add(`${file}: missing exported page ${expected}.`);
}

type Reference = { attribute: "href" | "src"; value: string };
type Page = {
  ids: Set<string>;
  references: Reference[];
  metadata: Map<string, string[]>;
  canonicals: string[];
};
const pages = new Map<string, Page>();
await Promise.all(
  htmlFiles.map(async (file) => {
    const page: Page = { ids: new Set(), references: [], metadata: new Map(), canonicals: [] };
    await new HTMLRewriter()
      .on("*", {
        element(element: HTMLRewriterTypes.Element): void {
          const id = element.getAttribute("id");
          if (id) page.ids.add(id);
          if (element.tagName === "a") {
            const name = element.getAttribute("name");
            if (name) page.ids.add(name);
          }
          if (element.tagName === "meta") {
            const key = element.getAttribute("property") ?? element.getAttribute("name");
            if (key) {
              const values = page.metadata.get(key) ?? [];
              values.push(element.getAttribute("content") ?? "");
              page.metadata.set(key, values);
            }
          }
          if (element.tagName === "link" && element.getAttribute("rel")?.split(/\s+/).includes("canonical")) {
            page.canonicals.push(element.getAttribute("href") ?? "");
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

function requiredValue(values: string[] | undefined, label: string): string | undefined {
  if (values?.length !== 1 || !values[0]?.trim()) {
    errors.add(`${label}: expected exactly one nonempty value, found ${values?.length ?? 0}.`);
    return undefined;
  }
  return values[0];
}

const expectedCards = new Set<string>();
const imageOwners = new Map<string, string>();
const imageHashes = new Map<string, string>();
let checkedCards = 0;
for (const [file, route] of contentPages) {
  const page = pages.get(file);
  if (!page) {
    errors.add(`${file}: missing content page for social metadata verification.`);
    continue;
  }

  // Social metadata always describes the published site, including in local builds
  // whose assets and navigation are served without the GitHub Pages base path.
  const canonicalUrl = `${publishedOrigin}${publishedBasePath}${route}`;
  const card = `og/${route.replace(/^\/+|\/+$/g, "") || "index"}.png`;
  const imageUrl = `${publishedOrigin}${publishedBasePath}/${card}`;
  expectedCards.add(card);
  const canonical = requiredValue(page.canonicals, `${file}: canonical URL`);
  if (canonical !== undefined && canonical !== canonicalUrl) {
    errors.add(`${file}: canonical URL must be ${canonicalUrl}, got ${JSON.stringify(canonical)}.`);
  }

  const expectedMetadata: Record<string, string> = {
    "og:url": canonicalUrl,
    "og:type": "website",
    "og:image": imageUrl,
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:image:type": "image/png",
    "twitter:card": "summary_large_image",
    "twitter:image": imageUrl,
  };
  for (const [key, expected] of Object.entries(expectedMetadata)) {
    const actual = requiredValue(page.metadata.get(key), `${file}: ${key}`);
    if (actual !== undefined && actual !== expected) {
      errors.add(`${file}: ${key} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
    }
  }
  for (const field of ["title", "description", "image:alt"]) {
    const ogValue = requiredValue(page.metadata.get(`og:${field}`), `${file}: og:${field}`);
    const twitterValue = requiredValue(page.metadata.get(`twitter:${field}`), `${file}: twitter:${field}`);
    if (ogValue !== undefined && twitterValue !== undefined && ogValue !== twitterValue) {
      errors.add(`${file}: og:${field} and twitter:${field} must match.`);
    }
    if (field === "description") {
      const description = requiredValue(page.metadata.get("description"), `${file}: description`);
      if (description !== undefined && ogValue !== undefined && description !== ogValue) {
        errors.add(`${file}: social description must match the page description.`);
      }
    }
  }

  const actualImage = page.metadata.get("og:image")?.[0];
  if (actualImage) {
    const owner = imageOwners.get(actualImage);
    if (owner) errors.add(`${file}: social image is shared with ${owner}; each content page needs a unique card.`);
    imageOwners.set(actualImage, file);
  }
  if (!files.has(card)) {
    errors.add(`${file}: missing exported social image ${card}.`);
    continue;
  }

  const image = await Bun.file(resolve(outDir, card)).bytes();
  if (image.byteLength >= 5_000_000) errors.add(`${card}: social image must be smaller than 5 MB.`);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (image.byteLength < 33 || !signature.every((byte, index) => image[index] === byte)) {
    errors.add(`${card}: social image is not a PNG with a complete IHDR header.`);
    continue;
  }
  const header = new DataView(image.buffer, image.byteOffset, image.byteLength);
  if (header.getUint32(8) !== 13 || Buffer.from(image.subarray(12, 16)).toString("ascii") !== "IHDR") {
    errors.add(`${card}: PNG must begin with a valid IHDR chunk.`);
    continue;
  }
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (width !== 1200 || height !== 630) {
    errors.add(`${card}: PNG dimensions must be 1200×630, got ${width}×${height}.`);
  }
  const hash = createHash("sha256").update(image).digest("hex");
  const duplicate = imageHashes.get(hash);
  if (duplicate) errors.add(`${card}: PNG content is identical to ${duplicate}; cards must be page-specific.`);
  imageHashes.set(hash, card);
  checkedCards++;
}
for (const file of files) {
  if (file.startsWith("og/") && file.endsWith(".png") && !expectedCards.has(file)) {
    errors.add(`${file}: social image does not belong to a known content page.`);
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

// Agent and crawler files: GitHub Pages serves them as-is, so verify their exported content.
const publishedPages = [...contentPages.values()].map((route) => `${publishedOrigin}${publishedBasePath}${route}`);
async function exportedText(path: string): Promise<string | undefined> {
  if (!files.has(path)) {
    errors.add(`Missing exported ${path}.`);
    return undefined;
  }
  return Bun.file(resolve(outDir, path)).text();
}

const sitemap = await exportedText("sitemap.xml");
if (sitemap !== undefined) {
  if (!sitemap.startsWith("<?xml") || !sitemap.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
    errors.add("sitemap.xml: expected an XML urlset in the sitemaps.org 0.9 namespace.");
  }
  const entries = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)];
  const locs = new Set(entries.map((entry) => entry[1]));
  for (const url of publishedPages) if (!locs.has(url)) errors.add(`sitemap.xml: missing ${url}.`);
  if (locs.size !== publishedPages.length) {
    errors.add(`sitemap.xml: expected ${publishedPages.length} URLs with lastmod, found ${locs.size}.`);
  }
  for (const [, loc, lastmod] of entries) {
    if (Number.isNaN(Date.parse(lastmod ?? ""))) errors.add(`sitemap.xml: invalid lastmod for ${loc}.`);
  }
}

const llms = await exportedText("llms.txt");
if (llms !== undefined) {
  if (!llms.startsWith("# ") || !/\n> \S/.test(llms)) errors.add("llms.txt: must open with an H1 and a blockquote.");
  if (!llms.includes("\n## When to use this\n")) errors.add("llms.txt: missing the 'When to use this' section.");
  for (const url of publishedPages.filter((url) => url.includes("/docs/"))) {
    if (!llms.includes(`](${url})`)) errors.add(`llms.txt: missing a link to ${url}.`);
  }
}

const llmsFull = await exportedText("llms-full.txt");
if (llmsFull !== undefined) {
  for (const url of publishedPages.filter((url) => url.includes("/docs/"))) {
    if (!llmsFull.includes(`<!-- Source: ${url} -->`)) errors.add(`llms-full.txt: missing the page ${url}.`);
  }
  if (/-->\n\n---\n/.test(llmsFull)) errors.add("llms-full.txt: front matter was not removed.");
  if (/\]\((?![a-z]+:|#)[^)]*\.md\b/i.test(llmsFull)) errors.add("llms-full.txt: has relative Markdown links.");
}

const home = await exportedText("index.html");
if (home !== undefined) {
  const types = new Set<string>();
  for (const [, json] of home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(json ?? "") as { "@graph"?: { "@type"?: string; contactPoint?: unknown }[] };
      for (const node of data["@graph"] ?? []) {
        if (node["@type"]) types.add(node["@type"]);
        if (node["@type"] === "Organization" && !node.contactPoint) {
          errors.add("index.html: Organization JSON-LD needs a contactPoint.");
        }
      }
    } catch {
      errors.add("index.html: JSON-LD is not valid JSON.");
    }
  }
  for (const type of ["Organization", "SoftwareApplication", "WebSite"]) {
    if (!types.has(type)) errors.add(`index.html: missing ${type} JSON-LD.`);
  }
  if (!/<html[^>]* lang="en"/.test(home)) errors.add('index.html: missing <html lang="en">.');
}

const notFound = await exportedText("404.html");
if (notFound !== undefined) {
  for (const link of ["/sitemap.xml", "/llms.txt"]) {
    if (!notFound.includes(`href="${basePath}${link}"`)) errors.add(`404.html: missing a link to ${link}.`);
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
    `${checkedAnchors} anchors, ${checkedCards} unique social cards, static search, agent files, and .nojekyll ` +
    `(base path: ${basePath || "/"}).`,
);
