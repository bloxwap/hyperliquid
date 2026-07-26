/**
 * Merges repeated perf measurements of the same revision into one report by taking each
 * scenario's minimum per-unit cost (see {@linkcode mergeReportsMin} for the rationale).
 *
 * Used by the CI perf gate: each revision is measured several times in alternating order, and
 * the per-scenario minima are what actually get compared — runner interference only ever makes
 * a measurement slower, so the minimum is the least-noise estimate.
 *
 * @example
 * ```sh
 * bun run .dev/perf/minimize.ts out.json run1.json run2.json run3.json
 * ```
 * @module
 */

import { mergeReportsMin, readReport } from "./compare.ts";

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length < 3) {
    console.error("usage: bun run .dev/perf/minimize.ts <out.json> <run1.json> <run2.json> [run3.json ...]");
    process.exit(2);
  }
  const [outPath, ...inputPaths] = args;
  const reports = await Promise.all(inputPaths.map(readReport));
  const merged = mergeReportsMin(reports);
  merged.meta.label = `${merged.meta.label ?? merged.meta.commit} (min of ${reports.length} runs)`;
  await Bun.write(outPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Wrote ${outPath}: ${merged.scenarios.length} scenarios, per-scenario min of ${reports.length} runs.`);
}
