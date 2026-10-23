/** Check a fresh relocated transport/signing import without preloading the API barrel. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as module from "node:module";

const specifier = process.argv[2];
assert(specifier, "A package entry point is required");
const pending = [import.meta.resolve(specifier)];
const seen = new Set();
while (pending.length) {
  const file = pending.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const code = readFileSync(new URL(file), "utf8");
  for (const match of code.matchAll(/\b(?:from\s*|import\s*)["']([^"'\n]+)["']/g)) {
    const dependency = match[1];
    assert(!/^valibot(?:\/|$)/.test(dependency), `${specifier} imports validation through ${file}`);
    if (dependency.startsWith(".")) pending.push(new URL(dependency, file).href);
  }
}
// registerHooks is available in newer Node 22 releases and Node 24. The closure check above
// also runs on the minimum supported Node and Bun, where synchronous loader hooks are absent.
if (!process.versions.bun && typeof module.registerHooks === "function") {
  module.registerHooks({
    load(url, context, nextLoad) {
      assert(!/[/\\]valibot(?:@[^/\\]+)?[/\\]/.test(url), `${specifier} evaluated Valibot: ${url}`);
      return nextLoad(url, context);
    },
  });
}
await import(specifier);
console.log(`${specifier} imports without validation (${seen.size} SDK modules).`);
