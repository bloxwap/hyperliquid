/**
 * Export Sync Checker
 *
 * Two gates over the public surface of the package:
 *
 * 1. Method sync — every `_methods/<name>.ts` file in an API module is re-exported from that module's `mod.ts` and
 *    `client.ts`, and neither file re-exports a method that no longer exists.
 * 2. Reachability — every module under `src/` is reachable by walking relative imports from the entry points declared
 *    in `package.json`'s `exports` map. An unreachable module is dead code that still ships in the repo; an
 *    unresolvable relative specifier is a broken edge in that same graph.
 *
 * The graph walk uses the TypeScript compiler API rather than a bundler: it only needs module specifiers, and parsing
 * is cheap enough that the whole tree is walked on every run.
 *
 * Usage: bun run .dev/export_sync_check.ts
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import process from "node:process";
import { Glob } from "bun";
import ts from "typescript";

// =============================================================================
// TYPES
// =============================================================================

/** A single violation. `scope` groups related violations, `subject` names the thing at fault. */
interface SyncError {
  scope: string;
  subject: string;
  errorType: string;
  details: string;
  filePath: string;
}

/** API endpoint configuration */
interface ApiEndpoint {
  name: string;
  methodsDir: string;
  clientPath: string;
  modPath: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Endpoints to check */
const API_ENDPOINTS: ApiEndpoint[] = [
  {
    name: "info",
    methodsDir: "src/api/info/_methods",
    clientPath: "src/api/info/client.ts",
    modPath: "src/api/info/mod.ts",
  },
  {
    name: "exchange",
    methodsDir: "src/api/exchange/_methods",
    clientPath: "src/api/exchange/client.ts",
    modPath: "src/api/exchange/mod.ts",
  },
  {
    name: "subscription",
    methodsDir: "src/api/subscription/_methods",
    clientPath: "src/api/subscription/client.ts",
    modPath: "src/api/subscription/mod.ts",
  },
  {
    name: "explorer",
    methodsDir: "src/api/explorer/_methods",
    clientPath: "src/api/explorer/client.ts",
    modPath: "src/api/explorer/mod.ts",
  },
];

/** Directory that every published module must live in, relative to the project root. */
const SOURCE_DIR = "src";

// =============================================================================
// PARSING
// =============================================================================

/** Get all method names from _methods directory */
async function getMethodsFromDir(methodsDir: string): Promise<Set<string>> {
  const methods = new Set<string>();
  const projectRoot = process.cwd();
  const fullPath = path.join(projectRoot, methodsDir);

  // `withFileTypes` keeps the `isFile()` filter that skipped nested directories under Deno.readDir.
  for (const entry of await readdir(fullPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (entry.name.startsWith("_")) continue;

    const methodName = entry.name.replace(".ts", "");
    methods.add(methodName);
  }

  return methods;
}

/** Parse exported methods from mod.ts */
async function parseModExports(modPath: string): Promise<Set<string>> {
  const methods = new Set<string>();
  const projectRoot = process.cwd();
  const fullPath = path.join(projectRoot, modPath);

  const content = await Bun.file(fullPath).text();

  // Match: export * from "./_methods/methodName.ts";
  const exportPattern = /export\s+\*\s+from\s+["']\.\/_methods\/(\w+)\.ts["']/g;

  for (const [, methodName] of content.matchAll(exportPattern)) {
    if (methodName.startsWith("_")) continue;
    methods.add(methodName);
  }

  return methods;
}

/** Parse exported methods from client.ts */
async function parseClientExports(clientPath: string): Promise<Set<string>> {
  const methods = new Set<string>();
  const projectRoot = process.cwd();
  const fullPath = path.join(projectRoot, clientPath);

  const content = await Bun.file(fullPath).text();

  // Match: export type { ... } from "./_methods/methodName.ts";
  const exportPattern = /export\s+type\s+\{[^}]+\}\s+from\s+["']\.\/_methods\/(\w+)\.ts["']/g;

  for (const [, methodName] of content.matchAll(exportPattern)) {
    if (methodName.startsWith("_")) continue;
    methods.add(methodName);
  }

  return methods;
}

// =============================================================================
// COMPARISON
// =============================================================================

/** Compare methods from _methods directory with mod.ts exports */
function compareModExports(methodsFromDir: Set<string>, modExports: Set<string>, endpoint: ApiEndpoint): SyncError[] {
  const errors: SyncError[] = [];
  const projectRoot = process.cwd();

  // Check for methods in _methods but not in mod.ts
  for (const methodName of methodsFromDir) {
    if (!modExports.has(methodName)) {
      errors.push({
        subject: methodName,
        scope: endpoint.name,
        errorType: "missing in mod.ts",
        details: `Method "${methodName}" exists in _methods/ but is not exported in mod.ts`,
        filePath: path.join(projectRoot, endpoint.modPath),
      });
    }
  }

  // Check for exports in mod.ts that don't exist in _methods
  for (const methodName of modExports) {
    if (!methodsFromDir.has(methodName)) {
      errors.push({
        subject: methodName,
        scope: endpoint.name,
        errorType: "extra in mod.ts",
        details: `Method "${methodName}" is exported in mod.ts but does not exist in _methods/`,
        filePath: path.join(projectRoot, endpoint.modPath),
      });
    }
  }

  return errors;
}

/** Compare methods from _methods directory with client.ts exports */
function compareClientExports(
  methodsFromDir: Set<string>,
  clientExports: Set<string>,
  endpoint: ApiEndpoint,
): SyncError[] {
  const errors: SyncError[] = [];
  const projectRoot = process.cwd();

  // Check for methods in _methods but not in client.ts
  for (const methodName of methodsFromDir) {
    if (!clientExports.has(methodName)) {
      errors.push({
        subject: methodName,
        scope: endpoint.name,
        errorType: "missing in client.ts",
        details: `Method "${methodName}" exists in _methods/ but is not exported in client.ts`,
        filePath: path.join(projectRoot, endpoint.clientPath),
      });
    }
  }

  // Check for exports in client.ts that don't exist in _methods
  for (const methodName of clientExports) {
    if (!methodsFromDir.has(methodName)) {
      errors.push({
        subject: methodName,
        scope: endpoint.name,
        errorType: "extra in client.ts",
        details: `Method "${methodName}" is exported in client.ts but does not exist in _methods/`,
        filePath: path.join(projectRoot, endpoint.clientPath),
      });
    }
  }

  return errors;
}

// =============================================================================
// REACHABILITY
// =============================================================================

/** Result of walking the module graph from the package entry points. */
interface ModuleGraph {
  /** Absolute paths of every module reached from an entry point. */
  reached: Set<string>;
  /** Relative specifiers that could not be resolved to a file on disk. */
  brokenEdges: { from: string; specifier: string }[];
}

/**
 * Read the entry point files a consumer can import, straight from `package.json`.
 *
 * Reading the manifest instead of hardcoding the list is what makes the gate self-maintaining: adding a subpath export
 * automatically extends the reachable set, and dropping one automatically shrinks it.
 */
async function readPackageEntryPoints(projectRoot: string): Promise<string[]> {
  const manifest = (await Bun.file(path.join(projectRoot, "package.json")).json()) as {
    exports?: Record<string, unknown>;
  };

  const entryPoints: string[] = [];
  for (const target of Object.values(manifest.exports ?? {})) {
    if (typeof target !== "string" || !target.endsWith(".ts")) continue;
    entryPoints.push(path.resolve(projectRoot, target));
  }

  return entryPoints;
}

/**
 * Resolve a relative module specifier to a file on disk.
 *
 * The repo writes explicit `.ts` extensions everywhere, but the extensionless and directory forms are accepted too so
 * the walk does not report a false broken edge if that convention ever loosens.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, "mod.ts"), path.join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) return candidate;
  }
  return undefined;
}

/** Collect every relative module specifier referenced by a source file, including `export ... from` re-exports. */
function collectRelativeSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    // Static `import`/`export ... from` covers the whole repo today; dynamic `import()` is walked too so a lazily
    // loaded module never looks unreachable.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) specifiers.push(specifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return specifiers.filter((specifier) => specifier.startsWith("."));
}

/** Walk the module graph depth-first from every entry point. */
function walkModuleGraph(entryPoints: string[]): ModuleGraph {
  const reached = new Set<string>();
  const brokenEdges: ModuleGraph["brokenEdges"] = [];
  const pending = [...entryPoints];

  while (pending.length > 0) {
    const filePath = pending.pop() as string;
    if (reached.has(filePath)) continue;
    reached.add(filePath);

    const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);

    for (const specifier of collectRelativeSpecifiers(sourceFile)) {
      const resolved = resolveSpecifier(filePath, specifier);
      if (resolved === undefined) {
        brokenEdges.push({ from: filePath, specifier });
        continue;
      }
      pending.push(resolved);
    }
  }

  return { reached, brokenEdges };
}

/** Verify every module under src/ is reachable from the package entry points, and every edge resolves. */
async function checkReachability(): Promise<SyncError[]> {
  const errors: SyncError[] = [];
  const projectRoot = process.cwd();
  const sourceRoot = path.join(projectRoot, SOURCE_DIR);

  const entryPoints = await readPackageEntryPoints(projectRoot);
  if (entryPoints.length === 0) {
    errors.push({
      scope: "exports",
      subject: "package.json",
      errorType: "no entry points",
      details: 'No TypeScript entry points found in the "exports" map; the reachability check would pass vacuously',
      filePath: path.join(projectRoot, "package.json"),
    });
    return errors;
  }

  for (const entryPoint of entryPoints) {
    if (existsSync(entryPoint)) continue;
    errors.push({
      scope: "exports",
      subject: path.relative(projectRoot, entryPoint),
      errorType: "missing entry point",
      details: 'Entry point declared in the "exports" map does not exist on disk',
      filePath: path.join(projectRoot, "package.json"),
    });
  }
  if (errors.length > 0) return errors;

  const { reached, brokenEdges } = walkModuleGraph(entryPoints);

  for (const { from, specifier } of brokenEdges) {
    errors.push({
      scope: "exports",
      subject: path.relative(projectRoot, from),
      errorType: "unresolvable import",
      details: `Relative specifier "${specifier}" does not resolve to a file on disk`,
      filePath: from,
    });
  }

  for (const modulePath of new Glob("**/*.ts").scanSync({ cwd: sourceRoot, absolute: true })) {
    if (reached.has(modulePath)) continue;
    errors.push({
      scope: "exports",
      subject: path.relative(projectRoot, modulePath),
      errorType: "unreachable module",
      details: `Module is not reachable from any entry point in the "exports" map of package.json`,
      filePath: modulePath,
    });
  }

  return errors;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const allErrors: SyncError[] = [];

  for (const endpoint of API_ENDPOINTS) {
    // Get methods from _methods directory
    const methodsFromDir = await getMethodsFromDir(endpoint.methodsDir);

    // Parse mod.ts exports
    const modExports = await parseModExports(endpoint.modPath);

    // Parse client.ts exports
    const clientExports = await parseClientExports(endpoint.clientPath);

    // Compare and collect errors
    allErrors.push(...compareModExports(methodsFromDir, modExports, endpoint));
    allErrors.push(...compareClientExports(methodsFromDir, clientExports, endpoint));
  }

  allErrors.push(...(await checkReachability()));

  // Success
  if (allErrors.length === 0) {
    console.log("All exports are synchronized.");
    process.exit(0);
  }

  // Print errors
  for (const error of allErrors) {
    console.log(`[ERROR] ${error.scope}.${error.subject}: ${error.errorType}`);
    console.log(`  ${error.details}`);
    console.log(`  File: ${error.filePath}`);
    console.log("");
  }

  console.log(`Found ${allErrors.length} error(s)`);
  process.exit(1);
}

// Entry point. The explicit `catch` keeps an I/O failure (a renamed directory, say) a readable non-zero failure
// instead of an unhandled rejection whose exit code depends on the runtime.
main().catch((error: unknown) => {
  console.log(`[ERROR] export sync check crashed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
