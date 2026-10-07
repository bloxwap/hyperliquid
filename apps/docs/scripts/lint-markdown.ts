/**
 * Lints the repository's Markdown: the root, SDK, and documentation-app READMEs plus every documentation page.
 *
 * Runs the markdownlint rule engine directly rather than through markdownlint-cli2. The CLI's file discovery
 * (globby → fast-glob → micromatch → braces) pulled in braces ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm, no patched release),
 * which failed the dependency scan; `Bun.Glob` finds the same files without that chain. Rules, configuration,
 * output format, and exit status match the CLI.
 *
 * @module
 */

import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Configuration, LintError } from "markdownlint";
import { lint } from "markdownlint/promise";

const APP_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR: string = resolve(APP_DIR, "../..");

/** Rule overrides; every other markdownlint rule keeps its default. */
const config: Configuration = {
  // This repository wraps prose at 120 columns, while the markdownlint default is 80.
  MD013: false,
  // Fumadocs frontmatter supplies navigation titles; Markdown keeps its visible H1.
  MD025: { front_matter_title: "" },
  // Separate GitHub alert blocks use blank quoted lines by design.
  MD028: false,
  // The root README starts with centered HTML branding, and embedded HTML is intentional there.
  MD033: false,
  MD041: false,
};

// Same set the CLI linted: three READMEs plus `content/**/*.md`. Bun.Glob skips dot-paths by default, as globby did.
const files: string[] = [
  join(ROOT_DIR, "README.md"),
  join(ROOT_DIR, "packages/hyperliquid/README.md"),
  join(APP_DIR, "README.md"),
  ...[...new Bun.Glob("content/**/*.md").scanSync({ cwd: APP_DIR, absolute: true })].sort(),
];

// Keyed by repository-relative path so the report names files the way a reader finds them.
const strings: Record<string, string> = {};
for (const file of files) strings[relative(ROOT_DIR, file)] = await Bun.file(file).text();

const results = await lint({ strings, config });
let failures = 0;
for (const [name, errors] of Object.entries(results).sort(([a], [b]) => a.localeCompare(b))) {
  for (const error of errors.toSorted((a: LintError, b: LintError) => a.lineNumber - b.lineNumber)) {
    // Mirrors markdownlint-cli2's default formatter: `file:line[:column] severity rule description [detail] [context]`.
    const column = error.errorRange?.[0] ? `:${error.errorRange[0]}` : "";
    const detail = error.errorDetail ? ` [${error.errorDetail}]` : "";
    const context = error.errorContext ? ` [Context: "${error.errorContext}"]` : "";
    console.error(
      `${name}:${error.lineNumber}${column} ${error.severity} ${error.ruleNames.join("/")} ${error.ruleDescription}${detail}${context}`,
    );
    // Like the CLI, only error-severity results fail the check.
    if (error.severity === "error") failures++;
  }
}

if (failures > 0) {
  console.error(`markdownlint: ${failures} error(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`markdownlint: ${files.length} files, no errors`);
