/**
 * Verifies Fumadocs navigation, page metadata, and GitHub-readable Markdown sources.
 *
 * @module
 */

import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR: string = join(ROOT_DIR, "docs");
const errors: string[] = [];
const files: string[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Each folder explicitly lists its immediate pages and subfolders in meta.json. */
async function checkNavigation(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  const expected: string[] = [];

  for (const entry of entries) {
    const path: string = join(dir, entry.name);
    if (entry.isDirectory()) {
      expected.push(entry.name);
      await checkNavigation(path);
    } else if (entry.name.endsWith(".md")) {
      files.push(path);
      // SUMMARY remains a GitHub index; Fumadocs uses meta.json as its only navigation source.
      if (entry.name !== "SUMMARY.md") {
        expected.push(entry.name === "README.md" ? "index" : entry.name.slice(0, -3));
      }
    }
  }

  const metadataPath: string = join(dir, "meta.json");
  const label: string = relative(ROOT_DIR, metadataPath);
  let metadata: unknown;
  try {
    metadata = await Bun.file(metadataPath).json();
  } catch (error) {
    errors.push(`${label} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!isRecord(metadata)) {
    errors.push(`${label} must contain an object`);
    return;
  }
  if (typeof metadata.title !== "string" || metadata.title.trim().length === 0) {
    errors.push(`${label} must declare a nonempty title`);
  }
  if (!Array.isArray(metadata.pages) || !metadata.pages.every((page): page is string => typeof page === "string")) {
    errors.push(`${label} must declare an explicit pages array of strings`);
    return;
  }

  const pages: string[] = metadata.pages.filter((page) => !/^---.*---$/.test(page));
  for (const page of new Set(expected)) {
    if (expected.filter((item) => item === page).length !== 1) {
      errors.push(`${label} has conflicting files or folders for ${page}`);
    }
    if (!pages.includes(page)) errors.push(`${label} is missing ${page}`);
  }
  for (const page of new Set(pages)) {
    if (!expected.includes(page)) errors.push(`${label} links to a missing or unsupported page: ${page}`);
    if (pages.filter((item) => item === page).length !== 1) errors.push(`${label} contains duplicate page: ${page}`);
  }
}

function checkFrontmatter(source: string, label: string): void {
  const match: RegExpMatchArray | null = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`${label} is missing YAML frontmatter`);
    return;
  }

  let metadata: unknown;
  try {
    metadata = Bun.YAML.parse(match[1]!);
  } catch (error) {
    errors.push(`${label} has invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const field of ["title", "description"]) {
    if (!isRecord(metadata) || typeof metadata[field] !== "string" || metadata[field].trim().length === 0) {
      errors.push(`${label} must declare a nonempty frontmatter ${field}`);
    }
  }
}

async function checkMarkdown(path: string): Promise<void> {
  const source: string = await Bun.file(path).text();
  const label: string = relative(ROOT_DIR, path);
  if (path.startsWith(`${DOCS_DIR}/`) && !path.endsWith("/SUMMARY.md")) checkFrontmatter(source, label);

  if (source.includes("{%")) errors.push(`${label} contains unsupported GitBook directives`);
  if (source.includes("bloxwap.gitbook.io")) errors.push(`${label} still links to the retired GitBook site`);

  // Source links remain relative Markdown links for GitHub; the website resolves them to page URLs at build time.
  const prose: string = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href: string = match[1]!.replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
    try {
      const target: string = resolve(dirname(path), decodeURIComponent(href.split(/[?#]/)[0]!));
      await stat(target);
    } catch {
      errors.push(`${label} links to a missing local file: ${href}`);
    }
  }
}

await checkNavigation(DOCS_DIR);
for (const path of [...files.sort(), join(ROOT_DIR, "README.md")]) await checkMarkdown(path);

if (errors.length > 0) {
  throw new Error(`Documentation check failed:\n${errors.map((message) => `- ${message}`).join("\n")}`);
}
console.log(
  `Fumadocs navigation covers all ${files.filter((path) => !path.endsWith("/SUMMARY.md")).length} pages; ` +
    "page metadata and local Markdown links are valid.",
);
