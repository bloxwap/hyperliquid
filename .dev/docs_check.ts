/**
 * Verifies that the repository-native documentation stays complete and GitHub-renderable.
 *
 * @module
 */

import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR: string = join(ROOT_DIR, "docs");
const SUMMARY_PATH: string = join(DOCS_DIR, "SUMMARY.md");

async function markdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(path)));
    } else if (entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function fail(messages: readonly string[]): never {
  throw new Error(`Documentation check failed:\n${messages.map((message) => `- ${message}`).join("\n")}`);
}

const files: string[] = (await markdownFiles(DOCS_DIR)).sort();
const relativeFiles: string[] = files.map((path) => relative(DOCS_DIR, path));
const pages: string[] = relativeFiles.filter((path) => path !== "SUMMARY.md");
const summary: string = await Bun.file(SUMMARY_PATH).text();
const summaryLinks: string[] = [...summary.matchAll(/\]\(([^)#?]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]!);

const errors: string[] = [];
const duplicateLinks: string[] = summaryLinks.filter((link, index) => summaryLinks.indexOf(link) !== index);
if (duplicateLinks.length > 0) {
  errors.push(`SUMMARY.md contains duplicate pages: ${[...new Set(duplicateLinks)].join(", ")}`);
}

for (const page of pages) {
  if (!summaryLinks.includes(page)) errors.push(`SUMMARY.md is missing ${page}`);
}
for (const link of summaryLinks) {
  if (!pages.includes(link)) errors.push(`SUMMARY.md links to a missing or non-page file: ${link}`);
}

for (const path of files) {
  const source: string = await Bun.file(path).text();
  if (source.includes("{%")) {
    errors.push(`${relative(DOCS_DIR, path)} contains unsupported GitBook directives`);
  }
}

if (errors.length > 0) fail(errors);
console.log(`Documentation index covers all ${pages.length} pages; no GitBook directives found.`);
