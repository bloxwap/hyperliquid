/**
 * Optional dependencies must not be statically reachable from a browser bundle.
 *
 * `tiny-secp256k1`'s browser build imports `secp256k1.wasm`, and `hash-wasm` / `viem/accounts`
 * are optional or absent for many consumers. A literal `import("…")` of any of them makes
 * `esbuild --bundle --platform=browser` fail on `ExchangeClient`. The specifiers stay opaque
 * (`import(SPEC)` plus the Vite/webpack ignore comments), so the bundle succeeds whether or not
 * those packages are installed, and Node/Bun still resolve them at runtime.
 * @module
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { build, type Plugin } from "esbuild";
import ts from "typescript";

/** Package root (`packages/hyperliquid`), so `@bloxwap/hyperliquid` resolves to this package. */
const ROOT = join(import.meta.dir, "../..");

/** Optional packages a browser bundle of the SDK must not ask esbuild to resolve. */
const OPTIONAL_SPECIFIERS = ["tiny-secp256k1", "hash-wasm", "viem/accounts"] as const;

/** Public entry points that pull the signing graph. */
const ENTRIES = [
  {
    name: ".",
    contents: `import { ExchangeClient } from "@bloxwap/hyperliquid";\nexport { ExchangeClient };\n`,
  },
  {
    name: "./api/exchange",
    contents: `import { order } from "@bloxwap/hyperliquid/api/exchange";\nexport { order };\n`,
  },
  {
    name: "./signing",
    contents:
      `import { createFastLocalWallet, signL1Action } from "@bloxwap/hyperliquid/signing";\n` +
      `export { createFastLocalWallet, signL1Action };\n`,
  },
] as const;

/** Fails the build if a bundler tries to resolve an optional dependency. */
const OPTIONAL_DEPS_ABSENT: Plugin = {
  name: "optional-deps-absent",
  setup(builder) {
    builder.onResolve({ filter: /^(?:tiny-secp256k1|hash-wasm|viem(?:\/.*)?)$/ }, (args) => ({
      errors: [{ text: `optional dependency ${args.path} must not be resolved while bundling` }],
    }));
  },
};

/** Literal `import("pkg")` / `import(\`pkg\`)` of an optional dependency, anywhere in `src/`. */
function literalOptionalImports(dir: string): string[] {
  const found: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ESNext, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const arg = node.arguments[0];
          if (
            arg !== undefined &&
            (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
            (OPTIONAL_SPECIFIERS as readonly string[]).includes(arg.text)
          ) {
            found.push(`${path}: import(${JSON.stringify(arg.text)})`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return found;
}

/**
 * Bundles one public entry the way a browser app would: esbuild, `platform: "browser"`, optional
 * dependencies left resolvable (or forced absent). Returns the bundle text.
 */
async function bundleEntry(contents: string, plugins: Plugin[]): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, sourcefile: "browser-entry.ts", loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    outfile: "bundle.js",
    logLevel: "silent",
    plugins,
  });
  return result.outputFiles[0]?.text ?? "";
}

/** A published-style bundle: neutral platform, packages external, whitespace minified. */
async function publishEntry(contents: string): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, sourcefile: "publish-entry.ts", loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    packages: "external",
    minifyWhitespace: true,
    write: false,
    outfile: "published.js",
    logLevel: "silent",
  });
  return result.outputFiles[0]?.text ?? "";
}

/** Browser-bundle JavaScript that already looks like the published package. */
async function bundlePublished(code: string, plugins: Plugin[]): Promise<string> {
  const result = await build({
    stdin: { contents: code, resolveDir: ROOT, sourcefile: "published.js", loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    outfile: "from-published.js",
    logLevel: "silent",
    plugins,
    // The published chunk imports `@noble/*` and `valibot` by package name from a virtual file.
    nodePaths: [join(ROOT, "node_modules")],
  });
  return result.outputFiles[0]?.text ?? "";
}

/** Literal dynamic imports that would make a consumer's bundler follow the optional package. */
function bundledLiteralImports(code: string): string[] {
  return OPTIONAL_SPECIFIERS.filter((specifier) =>
    new RegExp(`import\\s*\\(\\s*["']${specifier}["']\\s*\\)`).test(code),
  );
}

describe("browser bundles of ExchangeClient", () => {
  test("src/ has no literal import() of an optional dependency", () => {
    expect(literalOptionalImports(join(ROOT, "src"))).toEqual([]);
  });

  for (const entry of ENTRIES) {
    test(`esbuild --platform=browser bundles ${entry.name} with optional deps installed`, async () => {
      const code = await bundleEntry(entry.contents, []);
      expect(code).not.toContain("secp256k1.wasm");
      expect(bundledLiteralImports(code)).toEqual([]);
    });

    test(`esbuild --platform=browser bundles ${entry.name} when optional deps are absent`, async () => {
      const code = await bundleEntry(entry.contents, [OPTIONAL_DEPS_ABSENT]);
      expect(code).not.toContain("secp256k1.wasm");
      expect(bundledLiteralImports(code)).toEqual([]);
    });

    test(`a publish-style bundle of ${entry.name} still browser-bundles without optional deps`, async () => {
      const published = await publishEntry(entry.contents);
      expect(bundledLiteralImports(published)).toEqual([]);
      const code = await bundlePublished(published, [OPTIONAL_DEPS_ABSENT]);
      expect(code).not.toContain("secp256k1.wasm");
    });
  }
});
