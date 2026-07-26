/**
 * One-command performance gate: measure this tree, compare it to the committed baseline,
 * fail on any regression.
 *
 * This is the entry point CI runs (`bun run perf:gate`) and the enforcement point for the
 * project's policy: **a change may keep performance the same or improve it, never regress it.**
 * It is deliberately thin — the suite lives in `tests/perf/run.ts` and the comparison in
 * `.dev/perf/compare.ts`, and this file only wires them together.
 *
 * @example Gate the working tree
 * ```sh
 * bun run .dev/perf/gate.ts
 * ```
 *
 * @example Re-record the baseline (do it in the same commit as the scenario change)
 * ```sh
 * bun run .dev/perf/gate.ts --record
 * ```
 *
 * @example Loosen the threshold on a noisy machine
 * ```sh
 * bun run .dev/perf/gate.ts --threshold 15
 * ```
 *
 * Baselines are machine-specific: comparing reports from different CPUs, OSes, or runtimes
 * is refused outright (see `incomparableReason` in `compare.ts`) unless
 * `--allow-environment-mismatch` is passed for a rough look.
 * @module
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compareReports,
  incomparableReason,
  isFailure,
  readReport,
  renderComparison,
  renderFailure,
} from "./compare.ts";

/** Repository root, so the gate behaves the same from any working directory. */
const ROOT = resolve(import.meta.dir, "../..");
/** The performance suite entry point. */
const RUN_SCRIPT = join(ROOT, "tests/perf/run.ts");
/** The committed baseline every run is measured against. */
const BASELINE = join(ROOT, "tests/perf/results/baseline.json");
/**
 * Default slowdown allowed on top of both runs' margins of error.
 *
 * Wider than `compare.ts`'s own default: the gate compares two separate processes, often on
 * different days and always on a shared CI runner, and the per-element scenarios (under 100 ns
 * a unit) drift ~20% between processes on an otherwise idle machine. A real regression in this
 * suite is a multiple, not a few percent, so a wide band still catches everything that matters
 * while keeping the gate from crying wolf.
 */
const DEFAULT_THRESHOLD_PCT = 20;

/**
 * Runs the whole performance suite into `out`.
 *
 * Output is inherited rather than captured: on CI the suite's own table is the only record of
 * what the numbers were, and a captured buffer would be lost when the gate exits non-zero.
 *
 * @throws {Error} If the suite exits non-zero.
 */
async function runSuite(out: string, label?: string): Promise<void> {
  const args = [process.execPath, RUN_SCRIPT, "--out", out, ...(label ? ["--label", label] : [])];
  const child = Bun.spawn(args, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`tests/perf/run.ts exited with code ${code}`);
}

/** Reads a `--flag value` pair from the argument list. */
function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);

  // --- Baseline recording --------------------------------------------------
  if (args.includes("--record")) {
    await runSuite(BASELINE, "baseline");
    console.log(`\nRecorded baseline: ${BASELINE}`);
    process.exit(0);
  }

  const thresholdPct = Number(flag(args, "threshold") ?? DEFAULT_THRESHOLD_PCT);
  if (!Number.isFinite(thresholdPct) || thresholdPct < 0) {
    console.error(`--threshold must be a non-negative number, got ${flag(args, "threshold")}`);
    process.exit(2);
  }

  // Fail before spending a minute on measurements the gate could not use anyway.
  if (!(await Bun.file(BASELINE).exists())) {
    console.error(
      `No performance baseline at ${BASELINE}.\n` +
        `Record one on the machine that will run the gate, and commit it:\n` +
        `    bun run .dev/perf/gate.ts --record\n` +
        `Baselines are machine-specific: a baseline from a different CPU or runtime turns ` +
        `every comparison into noise.`,
    );
    process.exit(2);
  }

  // --- Measure -------------------------------------------------------------
  const dir = await mkdtemp(join(tmpdir(), "hl-perf-"));
  const currentPath = join(dir, "current.json");
  let exitCode = 0;
  try {
    await runSuite(currentPath);

    const baseline = await readReport(BASELINE);
    const current = await readReport(currentPath);

    // Same enforcement as the compare.ts CLI: different machines are not comparable.
    const incomparable = incomparableReason(baseline, current);
    if (incomparable && !args.includes("--allow-environment-mismatch")) {
      console.error(incomparable);
      exitCode = 2;
    } else {
      const result = compareReports(baseline, current, thresholdPct, {
        allowUnfingerprintedBase: args.includes("--allow-unfingerprinted-base"),
      });

      console.log(`\n${renderComparison(baseline, current, result, thresholdPct)}`);

      if (isFailure(result)) {
        console.error(`\n${renderFailure(result)}`);
        exitCode = 1;
      } else {
        console.log("\nPASS: no performance regressions.");
      }
    }
  } finally {
    // `process.exit` skips pending work, so the temp report is removed before exiting.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  if (exitCode !== 0) process.exit(exitCode);
}
