/**
 * Import Graph Checker
 *
 * Budgets the number of modules each public entry point pulls in at RUNTIME, so a barrel import
 * cannot quietly reattach a large subgraph to a small entry point again.
 *
 * This exists because of a measured regression: one value import of `../api/info/mod.ts` in
 * `src/utils/_symbolConverter.ts` — four functions from a barrel that re-exports every Info
 * method — made `@bloxwap/hyperliquid/utils` load **91 modules instead of 10**, costing 22.7 ms
 * on Node and 6.9 ms on Bun per process. Nothing in the test suite, the type gates or the export
 * gate noticed, because the import is perfectly valid and the package still behaves identically.
 * Only a budget catches it.
 *
 * Runtime edges are resolved syntactically, which is exact here because `verbatimModuleSyntax`
 * is on: a whole-statement `import type` / `export type` is erased and carries no runtime edge,
 * and anything else does — including `import { foo, type Bar }`, which keeps the statement. That
 * makes this check cheap enough to run on every `bun run check`, with no build step.
 *
 * Usage: bun run .dev/import_graph_check.ts
 *
 * @module
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Repository root, derived from this file's location so the script runs from any directory. */
const ROOT_DIR: string = resolve(fileURLToPath(import.meta.url), "../..");

/**
 * Runtime module budget per entry point.
 *
 * `limit` is the ceiling, set a little above the measured closure so ordinary growth does not
 * trip it. `why` explains what the budget protects, and is printed on failure — a budget whose
 * rationale is not obvious gets raised by the next person who trips it.
 */
const BUDGETS: readonly { entry: string; limit: number; why: string; forbid?: RegExp }[] = [
  {
    entry: "src/utils/mod.ts",
    limit: 20,
    why: "Formatting and symbol helpers must not drag in the Info API surface. Importing four functions from `api/info/mod.ts` instead of their `_methods/*` modules took this from 10 to 91 and cost 22.7 ms on Node.",
  },
  {
    entry: "src/transport/mod.ts",
    limit: 30,
    why: "The transports are the entry point for a consumer that wants no API surface at all.",
  },
  {
    entry: "src/signing/mod.ts",
    limit: 20,
    why: "The signing helpers stand alone; they must not reach into the API or transport layers.",
  },
  {
    entry: "src/api/info/client.ts",
    limit: 110,
    why: "The narrow read-only entry point. It legitimately pulls the Info methods it wraps, but must not also pull the exchange, subscription or signing graphs.",
  },
  {
    entry: "src/api/info/_methods/allMids.ts",
    limit: 12,
    why: "A single Info operation must not load sibling operations or signing.",
    forbid: /\/(?:signing|api\/(?:exchange|subscription)|transport\/websocket)\//,
  },
  {
    entry: "src/api/exchange/_methods/order.ts",
    limit: 35,
    why: "A single Exchange operation needs the signing and nonce core, but not sibling actions or the Info and Subscription graphs.",
    forbid: /\/api\/(?:info|subscription|explorer)\//,
  },
  {
    entry: "src/api/subscription/_methods/allMids.ts",
    limit: 8,
    why: "A single Subscription operation must not load sibling channels, the WebSocket transport or signing.",
    forbid: /\/(?:signing|api\/(?:exchange|info)|transport\/websocket)\//,
  },
  {
    entry: "src/api/explorer/_methods/explorerBlock.ts",
    limit: 12,
    why: "A single Explorer operation must remain independent of the other API families.",
    forbid: /\/(?:signing|api\/(?:exchange|info|subscription))\//,
  },
  {
    entry: "src/actions/order.ts",
    limit: 35,
    why: "An individual builder must not load the ExchangeClient or sibling action schemas.",
  },
];

/**
 * Operation entry points that must load strictly fewer modules than the client and barrel they
 * belong to. Budgets bound absolute growth; this pins the reason the entry points exist, so a
 * change that makes one operation as heavy as its whole family fails even inside its budget.
 */
const NARROWER_THAN: readonly { entry: string; wider: readonly string[] }[] = [
  { entry: "src/api/info/_methods/allMids.ts", wider: ["src/api/info/client.ts", "src/api/info/mod.ts"] },
  { entry: "src/api/exchange/_methods/order.ts", wider: ["src/api/exchange/client.ts", "src/api/exchange/mod.ts"] },
  {
    entry: "src/api/subscription/_methods/allMids.ts",
    wider: ["src/api/subscription/client.ts", "src/api/subscription/mod.ts"],
  },
  {
    entry: "src/api/explorer/_methods/explorerBlock.ts",
    wider: ["src/api/explorer/client.ts", "src/api/explorer/mod.ts"],
  },
  { entry: "src/actions/order.ts", wider: ["src/actions/mod.ts"] },
];

// =============================================================================
// GRAPH
// =============================================================================

/**
 * Module specifiers of `file` that survive compilation.
 *
 * Skips whole-statement `import type` / `export type` — erased under `verbatimModuleSyntax` —
 * and keeps everything else, including a mixed `import { foo, type Bar }` whose statement is
 * emitted. Bare specifiers (`valibot`, `@noble/hashes`) are ignored: the budget is about this
 * package's own graph, and a dependency's internals are not ours to police.
 */
function runtimeEdges(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
  const out: string[] = [];
  for (const statement of source.statements) {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue;
      specifier = statement.moduleSpecifier;
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || statement.moduleSpecifier === undefined) continue;
      specifier = statement.moduleSpecifier;
    }
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    if (!specifier.text.startsWith(".")) continue;
    out.push(specifier.text);
  }
  return out;
}

/** Every module reachable from `entry` through runtime edges, including `entry` itself. */
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeEdges(file)) {
      stack.push(resolve(dirname(file), specifier));
    }
  }
  return seen;
}

// =============================================================================
// MAIN
// =============================================================================

const sizes = new Map<string, number>();
/** Runtime closure size of `entry`, memoized across the budget and comparison passes. */
function sizeOf(entry: string): number {
  let size = sizes.get(entry);
  if (size === undefined) sizes.set(entry, (size = closure(resolve(ROOT_DIR, entry)).size));
  return size;
}

let failed = false;
for (const { entry, limit, why, forbid } of BUDGETS) {
  const modules = closure(resolve(ROOT_DIR, entry));
  const size = modules.size;
  sizes.set(entry, size);
  const leaked = forbid
    ? [...modules].map((file) => relative(ROOT_DIR, file)).filter((file) => forbid.test(`/${file}`))
    : [];
  const status = size <= limit && leaked.length === 0 ? "ok" : "OVER";
  console.log(`${status.padEnd(5)} ${entry.padEnd(44)} ${String(size).padStart(4)} / ${limit}`);
  if (size > limit) {
    failed = true;
    console.error(`\n  ${entry} now loads ${size} modules at runtime, over its budget of ${limit}.`);
    console.error(`  ${why}`);
    console.error(
      "  Import the specific modules you need rather than a `mod.ts` barrel, or raise the budget deliberately.\n",
    );
  }
  if (leaked.length > 0) {
    failed = true;
    console.error(`\n  ${entry} reaches modules outside its family: ${leaked.join(", ")}.`);
    console.error(`  ${why}\n`);
  }
}

for (const { entry, wider } of NARROWER_THAN) {
  for (const other of wider) {
    const [narrow, broad] = [sizeOf(entry), sizeOf(other)];
    if (narrow < broad) continue;
    failed = true;
    console.error(`\n  ${entry} loads ${narrow} modules, no fewer than ${other} (${broad}).`);
    console.error("  A one-operation entry point that is as heavy as its client or barrel has no reason to exist.\n");
  }
}

if (failed) {
  console.error("Import graph budgets exceeded.");
  process.exit(1);
}
console.log(
  `All ${BUDGETS.length} import graph budgets are within limits, and ${NARROWER_THAN.length} operation entry points are narrower than their clients and barrels.`,
);
