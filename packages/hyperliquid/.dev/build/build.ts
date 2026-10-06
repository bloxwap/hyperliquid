/**
 * Emits the publishable npm package into `dist/`.
 *
 * The SDK's `package.json` deliberately points its `exports` at TypeScript sources so Bun, the tests and the
 * JSDoc examples can consume the SDK without a build step. npm consumers need real JavaScript and declaration files,
 * so this script emits declarations with `tsc`, bundles the JavaScript with esbuild, and writes a second,
 * publish-only manifest whose `exports` point at the emitted `.js`/`.d.ts` files.
 *
 * The JavaScript is bundled rather than emitted file-for-file because module count, not code size, dominated
 * start-up: `tsc`'s one-file-per-module output made Node load ~95 modules for an info-only consumer (21.5 ms) and
 * ~255 for the root barrel (59.4 ms). Each entry point is bundled with code splitting, so modules shared between
 * entry points land in shared chunks and stay single instances — process-wide state such as the keccak provider,
 * the nonce manager, the shared WebSocket quota and the error classes behind `instanceof` checks is never
 * duplicated across subpath imports. Dependencies stay external: inlining them would duplicate a consumer's own
 * copy of `valibot` and bypass the semver ranges in the manifest.
 *
 * @example
 * ```sh
 * bun run .dev/build/build.ts
 * ```
 *
 * @module
 */

import { copyFile, cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative as pathRelative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

// --- Layout ------------------------------------------------------------------

/** SDK package root, derived from this file's location so the script is runnable from any working directory. */
const ROOT_DIR: string = resolve(fileURLToPath(import.meta.url), "../../..");

/** Output directory of the publishable package. Recreated from scratch on every run. */
const DIST_DIR: string = join(ROOT_DIR, "dist");

/** Build-only compiler configuration (emit enabled, tests excluded). See `./tsconfig.build.json`. */
const BUILD_TSCONFIG: string = join(ROOT_DIR, ".dev/build/tsconfig.build.json");

/** Consumer-facing documentation shipped inside the npm tarball. */
const COPIED_FILES: readonly string[] = ["README.md", "LICENSE"];

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
  "publishConfig",
  "dependencies",
  "optionalDependencies",
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
 * Emits declaration files for `src/` into `dist/` (JavaScript is emitted by {@linkcode bundleSources}).
 *
 * @throws If `tsc` reports any diagnostic; its output is streamed to this process' stdio.
 */
async function emitDeclarations(): Promise<void> {
  const tsc = Bun.spawn(["bunx", "tsc", "--project", BUILD_TSCONFIG], {
    cwd: ROOT_DIR,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await tsc.exited;
  if (code !== 0) throw new Error(`tsc exited with code ${code}`);
}

/**
 * Bundles every export entry point into `dist/` as ESM, with shared modules split into `dist/_chunks/`.
 *
 * Entry files keep their source-relative paths (`src/api/info/client.ts` → `dist/api/info/client.js`), so they sit
 * next to the declaration files `tsc` emits for them. Bare specifiers — the dependencies, and the optional ones
 * loaded through dynamic `import()` — stay external. `platform: "neutral"` because the SDK runs in browsers as well
 * as Node and Bun, and reaches Node built-ins only through runtime feature checks.
 *
 * esbuild rather than `Bun.build`: Bun 1.4's code splitting emitted an entry that re-exported a binding from a
 * chunk it never imported (`export { AbstractWalletError }` in `dist/mod.js`), which Node rejects at link time.
 *
 * @param root - The parsed root manifest, whose `exports` targets are the entry points.
 * @returns The number of JavaScript files written.
 * @throws If the bundler reports any error.
 */
async function bundleSources(root: RootManifest): Promise<number> {
  // Per-operation entry points would force the client bundles into hundreds of tiny chunks.
  // Bundle pure operation/schema code separately, but externalize every identity/state boundary
  // to one shared core so mixed entry points keep instanceof, nonce, and action ownership intact.
  const core = [
    "_base.ts",
    "api/_errors.ts",
    "signing/mod.ts",
    "signing/_canonicalize.ts",
    "transport/_base.ts",
    "api/exchange/_methods/_base/_shell.ts",
    "api/exchange/_methods/_base/_nonce.ts",
    "api/exchange/_methods/_base/execute.ts",
    "actions/_canonical.ts",
    "actions/execution.ts",
    "api/subscription/_methods/fastAssetCtxs.ts",
  ];
  const coreFiles = new Map<string, { group: string; exports: string }>();
  const aggregators = new Map<string, string>();
  for (const [index, name] of core.entries()) {
    const file = join(ROOT_DIR, "src", name);
    const group = ["_base.ts", "api/_errors.ts", "transport/_base.ts"].includes(name)
      ? "runtime"
      : name === "signing/mod.ts"
        ? "signing"
        : ["actions/_canonical.ts", "signing/_canonicalize.ts"].includes(name)
          ? "canonical"
          : name === "api/subscription/_methods/fastAssetCtxs.ts"
            ? "subscriptions"
            : "exchange";
    const names = Object.keys(await import(file));
    const aliases = names.map((value) => ({ value, alias: `m${index}_${value}` }));
    const exports = aliases.map(({ value, alias }) => `${alias} as ${value}`).join(", ");
    coreFiles.set(file, { group, exports });
    aggregators.set(
      group,
      (aggregators.get(group) ?? "") +
        `export { ${aliases.map(({ value, alias }) => `${value} as ${alias}`).join(", ")} } from ${JSON.stringify(file)};\n`,
    );
  }
  const primary: string[] = [];
  const narrow: string[] = [];
  for (const target of new Set(Object.values(root.exports))) {
    const file = join(ROOT_DIR, target);
    const shared = coreFiles.get(file);
    if (shared) {
      const output = join(DIST_DIR, target.slice("./src/".length).replace(/\.ts$/, ".js"));
      // Declarations already created the parent directories.
      const specifier = pathRelative(dirname(output), join(DIST_DIR, "_core", `${shared.group}.js`));
      await writeFile(
        output,
        `export { ${shared.exports} } from ${JSON.stringify(specifier.startsWith(".") ? specifier : `./${specifier}`)};\n`,
      );
    } else if (
      /\/api\/[^/]+\/_methods\/[^/]+\.ts$/.test(file) ||
      /\/actions\/(?!mod\.ts|orderBatcher\.ts)[^/]+\.ts$/.test(file)
    ) {
      narrow.push(file);
    } else primary.push(file);
  }
  const common = {
    outbase: join(ROOT_DIR, "src"),
    tsconfig: BUILD_TSCONFIG,
    bundle: true,
    format: "esm" as const,
    platform: "neutral" as const,
    target: "es2024",
    packages: "external" as const,
    entryNames: "[dir]/[name]",
    // Keep readable identifiers while avoiding comment/whitespace parsing at startup.
    minifyWhitespace: true,
    metafile: true as const,
    logLevel: "warning" as const,
  };
  const externalCore: import("esbuild").Plugin = {
    name: "shared-sdk-core",
    setup(builder): void {
      builder.onResolve({ filter: /^\./ }, (args) => {
        const resolved = resolve(args.resolveDir, args.path);
        return coreFiles.has(resolved)
          ? { path: resolved, namespace: "sdk-core-proxy", sideEffects: false }
          : undefined;
      });
      // Internal proxies give esbuild explicit names for external core exports, so
      // overlapping wildcard exports remain unambiguous and proxies add no runtime files.
      builder.onLoad({ filter: /.*/, namespace: "sdk-core-proxy" }, (args) => {
        const shared = coreFiles.get(args.path)!;
        return {
          contents: `export { ${shared.exports} } from ${JSON.stringify(join(DIST_DIR, "_core", `${shared.group}.js`))};`,
          loader: "js",
        };
      });
      builder.onResolve({ filter: /.*/, namespace: "sdk-core-proxy" }, (args) => ({
        path: args.path,
        external: true,
        sideEffects: false,
      }));
    },
  };
  const aggregateCore: import("esbuild").Plugin = {
    name: "aggregate-sdk-core",
    setup(builder): void {
      builder.onResolve({ filter: /^sdk-core:/ }, (args) => ({
        path: args.path.slice("sdk-core:".length),
        namespace: "sdk-core",
      }));
      builder.onLoad({ filter: /.*/, namespace: "sdk-core" }, (args) => ({
        contents: aggregators.get(args.path)!,
        loader: "js",
        resolveDir: ROOT_DIR,
      }));
    },
  };
  const outputs = [
    await esbuild({
      ...common,
      entryPoints: [
        ...primary.map((file) => ({ in: file, out: pathRelative(join(ROOT_DIR, "src"), file).replace(/\.ts$/, "") })),
        ...[...aggregators.keys()].map((group) => ({ in: `sdk-core:${group}`, out: `_core/${group}` })),
      ],
      plugins: [aggregateCore],
      outdir: DIST_DIR,
      splitting: true,
      chunkNames: "_chunks/[name]-[hash]",
    }),
    await esbuild({ ...common, entryPoints: narrow, outdir: DIST_DIR, splitting: false, plugins: [externalCore] }),
  ];
  let count = core.filter((name) => Object.values(root.exports).includes(`./src/${name}`)).length;
  for (const output of outputs)
    for (const file of Object.keys(output.metafile.outputs)) {
      const absolute = resolve(ROOT_DIR, file);
      const code = await Bun.file(absolute).text();
      const portable = code.replace(/(?:\bfrom\s*|\bimport\s*)"([^"\n]+)"/g, (match, specifier: string) => {
        if (!specifier.startsWith(`${DIST_DIR}/_core/`)) return match;
        const relative = pathRelative(dirname(absolute), specifier);
        return match.replace(
          JSON.stringify(specifier),
          JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`),
        );
      });
      // The package promises sideEffects:false. esbuild's splitting emits bare chunk
      // imports for evaluation ordering, even when that entry uses none of their bindings.
      // Bundled consumers drop these already; unbundled Node/Bun consumers need the same
      // behavior to prevent an Info-only import from evaluating exchange/signing chunks.
      const isolated = portable.replace(/\bimport\s*"(\.{1,2}\/[^"\n]+)"\s*;/g, (match, specifier: string) => {
        return resolve(dirname(absolute), specifier).startsWith(join(DIST_DIR, "_chunks")) ? "" : match;
      });
      if (isolated.includes(DIST_DIR)) throw new Error(`Non-portable SDK path in ${file}`);
      if (isolated !== code) await writeFile(absolute, isolated);
      count++;
    }
  return count;
}

/**
 * Loads every emitted entry point in Node and checks that it exports exactly what its TypeScript source exports.
 *
 * A bundler that emits unlinkable ESM fails silently until a consumer imports the package — the `Bun.build` output
 * this script once produced passed every in-repo check and only broke under Node's linker. Running the check as part
 * of the build makes a broken bundle a failed build instead of a broken release.
 *
 * @param root - The parsed root manifest.
 * @throws If Node cannot load an entry, or an entry's export names differ from its source's.
 */
async function verifyBundle(root: RootManifest): Promise<void> {
  for (const entry of ["api/info/client.js", "api/info/_methods/allMids.js", "transport/http/mod.js"]) {
    const pending = [join(DIST_DIR, entry)];
    const seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const code = await Bun.file(file).text();
      if (
        /\b(?:function (?:signL1Action|createL1ActionHash)|class (?:ExchangeClient|SubscriptionClient))\b/.test(code)
      ) {
        throw new Error(`Read-only ${entry} evaluates exchange/subscription/signing code through ${file}`);
      }
      for (const match of code.matchAll(/\b(?:from\s*|import\s*)"(\.{1,2}\/[^"\n]+)"/g)) {
        pending.push(resolve(dirname(file), match[1]));
      }
    }
  }
  const expected: Record<string, string[]> = {};
  for (const target of Object.values(root.exports)) {
    const source = (await import(join(ROOT_DIR, target))) as Record<string, unknown>;
    expected[toEmittedConditions(target).default] = Object.keys(source).sort();
  }

  const script = `
    const entries = ${JSON.stringify(Object.keys(expected))};
    const out = {};
    for (const entry of entries) out[entry] = Object.keys(await import(new URL(entry, ${JSON.stringify(`file://${DIST_DIR}/`)}))).sort();
    console.log(JSON.stringify(out));
  `;
  const node = Bun.spawn(["node", "--input-type=module", "-e", script], { cwd: ROOT_DIR, stderr: "inherit" });
  const [stdout, code] = await Promise.all([new Response(node.stdout).text(), node.exited]);
  if (code !== 0) throw new Error(`Node failed to load the bundled entry points (exit code ${code}).`);

  const actual = JSON.parse(stdout) as Record<string, string[]>;
  for (const [entry, names] of Object.entries(expected)) {
    if (JSON.stringify(actual[entry]) !== JSON.stringify(names)) {
      throw new Error(`Bundled ${entry} exports [${actual[entry]}], but its source exports [${names}].`);
    }
  }
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
 * @param target - Root export target, relative to the SDK package root.
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
  // Hundreds of repetitive conditions enlarge package.json and slow Node's package-scope
  // lookup on every cold import. Source exports stay explicit and checked; published operation
  // families use the same file layout through compact patterns. Private underscore paths stay closed.
  const exports: Record<string, { types: string; default: string } | null> = {};
  for (const [subpath, target] of Object.entries(root.exports)) {
    if (target.includes("/_methods/") || subpath.startsWith("./actions/")) continue;
    exports[subpath] = toEmittedConditions(target);
  }
  for (const family of ["info", "exchange", "explorer", "subscription"]) {
    exports[`./api/${family}/*`] = {
      types: `./api/${family}/_methods/*.d.ts`,
      default: `./api/${family}/_methods/*.js`,
    };
    exports[`./api/${family}/_*`] = null;
  }
  exports["./actions/*"] = { types: "./actions/*.d.ts", default: "./actions/*.js" };
  exports["./actions/_*"] = null;
  manifest.exports = exports;

  await writeFile(join(DIST_DIR, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Copies the documentation files that ship inside the npm tarball into `dist/`. */
async function copyDocs(): Promise<void> {
  await Promise.all(COPIED_FILES.map((name) => copyFile(join(ROOT_DIR, name), join(DIST_DIR, name))));
}

/** Check public runtime resolution, shared state, and type inference after relocating the package. */
async function verifyConsumer(root: RootManifest): Promise<void> {
  const consumer = await mkdtemp(join(tmpdir(), "hl-published-consumer-"));
  try {
    const modules = join(consumer, "node_modules");
    await mkdir(join(modules, "@bloxwap"), { recursive: true });
    await cp(DIST_DIR, join(modules, root.name), { recursive: true });
    for (const name of Object.keys(root.dependencies as Record<string, string>)) {
      const target = join(modules, name);
      await mkdir(dirname(target), { recursive: true });
      await symlink(join(ROOT_DIR, "node_modules", name), target, "dir");
    }
    await writeFile(join(consumer, "package.json"), '{"type":"module"}\n');
    const entries: Record<string, string[]> = {};
    for (const [subpath, target] of Object.entries(root.exports)) {
      const specifier = subpath === "." ? root.name : `${root.name}${subpath.slice(1)}`;
      entries[specifier] = Object.keys(await import(join(ROOT_DIR, target))).sort();
    }
    await writeFile(join(consumer, "entries.json"), JSON.stringify(entries));
    for (const name of ["consumer.ts", "consumer.mjs"]) {
      await copyFile(join(ROOT_DIR, ".dev/build", name), join(consumer, name));
    }
    const commands = [
      ["node", "consumer.mjs"],
      [process.execPath, "consumer.mjs"],
      [
        process.execPath,
        join(ROOT_DIR, "node_modules/typescript/bin/tsc"),
        "consumer.ts",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--target",
        "es2024",
      ],
    ];
    for (const command of commands) {
      const child = Bun.spawn(command, { cwd: consumer, stdio: ["inherit", "inherit", "inherit"] });
      const code = await child.exited;
      if (code !== 0) throw new Error(`Published consumer failed: ${command[0]} (exit ${code})`);
    }
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

// --- Entry point -------------------------------------------------------------

/**
 * Runs the full build: clean, emit declarations, bundle, verify the bundle in Node, fix declaration specifiers, emit
 * the manifest, copy docs.
 *
 * @throws If any step fails; the process exit code is left to the caller.
 */
export async function build(): Promise<void> {
  const root = await readRootManifest();

  await rm(DIST_DIR, { recursive: true, force: true });
  await emitDeclarations();
  const bundled = await bundleSources(root);
  await verifyBundle(root);
  const rewritten = await rewriteDeclarationExtensions(DIST_DIR);
  await writeDistManifest(root);
  await copyDocs();
  await verifyConsumer(root);

  console.log(
    `Built ${root.name}@${root.version} into dist/ (${bundled} JavaScript files, ${rewritten} declaration files rewritten).`,
  );
}

if (import.meta.main) {
  await build();
}
