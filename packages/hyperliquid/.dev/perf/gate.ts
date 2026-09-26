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

/** Sampling noise above which a recorded entry is not worth comparing against, in percent. */
const NOISY_RME_PCT = 15;

/**
 * Warns about entries recorded with too much sampling noise to be a useful baseline.
 *
 * A high-`rme` entry is worse than no entry: the gate compares against it for months, and
 * anyone reading the report treats it as the truth. The recorded
 * `signing/order_e2e_no_ecdsa_unchecked` sat at 3031.9 ns with **41.0% rme** — a figure that
 * does not reproduce (the same scenario measures 8–12 µs across a dozen fresh processes) — and
 * three separate performance audits each spent effort explaining a 7.7 µs "validation cost"
 * that only existed because that one number was noise.
 *
 * This warns rather than fails: a noisy machine is a reason to re-record, not to block the
 * person doing it, and some scenarios are legitimately jittery.
 */
export async function warnOnNoisyEntries(path: string): Promise<void> {
  const report = (await Bun.file(path).json()) as { scenarios?: { name: string; nsPerUnit: number; rme: number }[] };
  const noisy = (report.scenarios ?? []).filter((s) => s.rme > NOISY_RME_PCT).sort((a, b) => b.rme - a.rme);
  if (noisy.length === 0) return;

  console.warn(
    `\n${noisy.length} scenario(s) recorded above ${NOISY_RME_PCT}% rme. A baseline entry this noisy will produce` +
      ` false regressions and false all-clears for as long as it is committed:`,
  );
  for (const s of noisy)
    console.warn(`  ${s.rme.toFixed(1).padStart(5)}%  ${s.nsPerUnit.toFixed(1).padStart(10)} ns  ${s.name}`);
  console.warn("Re-record on an idle machine before committing, or accept these entries deliberately.\n");
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);

  // --- Baseline recording --------------------------------------------------
  if (args.includes("--record")) {
    await runSuite(BASELINE, "baseline");
    console.log(`\nRecorded baseline: ${BASELINE}`);
    await warnOnNoisyEntries(BASELINE);
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
