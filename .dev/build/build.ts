/**
 * Emits the publishable npm package into `dist/`.
 *
 * The repository root `package.json` deliberately points its `exports` at TypeScript sources so Bun, the tests and the
 * JSDoc examples can consume the SDK without a build step. npm consumers need real JavaScript and declaration files,
 * so this script compiles `src/` with `tsc` and writes a second, publish-only manifest whose `exports` point at the
 * emitted `.js`/`.d.ts` files.
 *
 * @example
 * ```sh
 * bun run .dev/build/build.ts
 * ```
 *
 * @module
 */

import { copyFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --- Layout ------------------------------------------------------------------

/** Repository root, derived from this file's location so the script is runnable from any working directory. */
const ROOT_DIR: string = resolve(fileURLToPath(import.meta.url), "../../..");

/** Output directory of the publishable package. Recreated from scratch on every run. */
const DIST_DIR: string = join(ROOT_DIR, "dist");

/** Build-only compiler configuration (emit enabled, tests excluded). See `./tsconfig.build.json`. */
const BUILD_TSCONFIG: string = join(ROOT_DIR, ".dev/build/tsconfig.build.json");

/** Documentation shipped inside the npm tarball. */
const COPIED_FILES: readonly string[] = ["README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md"];

/** Root manifest keys copied verbatim into the emitted manifest. */
const INHERITED_KEYS = [
  "name",
  "version",
  "description",
  "license",
  "type",
  "sideEffects",
  "keywords",
  "homepage",
  "bugs",
  "repository",
  "engines",
  "dependencies",
] as const;

// --- Types -------------------------------------------------------------------

/**
 * The subset of the root `package.json` this script reads.
 *
 * Only the fields that end up in the emitted manifest are typed; everything else (`scripts`, `devDependencies`, the
 * `//`-prefixed documentation keys) is intentionally dropped.
 */
interface RootManifest {
  /** Package name, shared with the emitted manifest. */
  name: string;
  /** Package version, shared with the emitted manifest. Also the version CI publishes. */
  version: string;
  /** Entry points, keyed by subpath and pointing at TypeScript sources. Rewritten to emitted files. */
  exports: Record<string, string>;
  /** Remaining inherited fields, copied without inspection. */
  [key: string]: unknown;
}

// --- Steps -------------------------------------------------------------------

/**
 * Reads and minimally validates the root `package.json`.
 *
 * @returns The parsed root manifest.
 * @throws If `exports` is missing or maps a subpath to anything other than a single `./src/*.ts` string.
 */
async function readRootManifest(): Promise<RootManifest> {
  const manifest = (await Bun.file(join(ROOT_DIR, "package.json")).json()) as RootManifest;
  if (typeof manifest.exports !== "object" || manifest.exports === null) {
    throw new Error("Root package.json has no `exports` map to mirror.");
  }
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target !== "string" || !target.startsWith("./src/") || !target.endsWith(".ts")) {
      throw new Error(`Root export "${subpath}" must be a "./src/*.ts" string, got: ${JSON.stringify(target)}`);
    }
  }
  return manifest;
}

/**
 * Compiles `src/` into `dist/` as ESM plus declaration files.
 *
 * @throws If `tsc` reports any diagnostic; its output is streamed to this process' stdio.
 */
async function compileSources(): Promise<void> {
  const tsc = Bun.spawn(["bunx", "tsc", "--project", BUILD_TSCONFIG], {
    cwd: ROOT_DIR,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await tsc.exited;
  if (code !== 0) throw new Error(`tsc exited with code ${code}`);
}

/**
 * Rewrites relative `.ts` import specifiers to `.js` inside emitted declaration files.
 *
 * `rewriteRelativeImportExtensions` only rewrites the JavaScript emit; declaration files keep the original `.ts`
 * specifiers (TypeScript 5.9), which no consumer can resolve. Bare specifiers are left alone so the JSDoc examples
 * that import from `@bloxwap/hyperliquid/*` stay readable.
 *
 * @param dir - Directory to walk recursively.
 * @returns The number of declaration files rewritten.
 */
async function rewriteDeclarationExtensions(dir: string): Promise<number> {
  let rewritten = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewritten += await rewriteDeclarationExtensions(path);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;

    const source = await Bun.file(path).text();
    const patched = source.replace(/(from\s*"|import\s*\(\s*")(\.{1,2}\/[^"]*)\.ts(")/g, "$1$2.js$3");
    if (patched !== source) {
      await writeFile(path, patched);
      rewritten++;
    }
  }
  return rewritten;
}

/**
 * Translates a root export target (`./src/signing/mod.ts`) into an emitted-file conditions object.
 *
 * @param target - Root export target, relative to the repository root.
 * @returns `types`/`default` conditions relative to `dist/`.
 */
function toEmittedConditions(target: string): { types: string; default: string } {
  const base = target.slice("./src/".length, -".ts".length);
  return { types: `./${base}.d.ts`, default: `./${base}.js` };
}

/**
 * Writes `dist/package.json`: the root manifest minus dev-only fields, with `exports` remapped to emitted files.
 *
 * @param root - The parsed root manifest.
 */
async function writeDistManifest(root: RootManifest): Promise<void> {
  const manifest: Record<string, unknown> = {};
  for (const key of INHERITED_KEYS) {
    if (root[key] !== undefined) manifest[key] = root[key];
  }
  // ESM-only package: consumers resolve through `exports` alone, so no `main`/`module`/`types` fallbacks are emitted.
  manifest.exports = Object.fromEntries(
    Object.entries(root.exports).map(([subpath, target]) => [subpath, toEmittedConditions(target)]),
  );

  await writeFile(join(DIST_DIR, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Copies the documentation files that ship inside the npm tarball into `dist/`. */
async function copyDocs(): Promise<void> {
  await Promise.all(COPIED_FILES.map((name) => copyFile(join(ROOT_DIR, name), join(DIST_DIR, name))));
}

// --- Entry point -------------------------------------------------------------

/**
 * Runs the full build: clean, compile, fix declaration specifiers, emit the manifest, copy docs.
 *
 * @throws If any step fails; the process exit code is left to the caller.
 */
export async function build(): Promise<void> {
  const root = await readRootManifest();

  await rm(DIST_DIR, { recursive: true, force: true });
  await compileSources();
  const rewritten = await rewriteDeclarationExtensions(DIST_DIR);
  await writeDistManifest(root);
  await copyDocs();

  console.log(`Built ${root.name}@${root.version} into dist/ (${rewritten} declaration files rewritten).`);
}

if (import.meta.main) {
  await build();
}
