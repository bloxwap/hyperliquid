/**
 * Zero-performance-regression gate.
 *
 * Compares two {@linkcode PerfReport} files scenario-by-scenario and exits non-zero if any
 * scenario got materially slower. This is the enforcement point for the project's policy:
 * **a change may keep performance the same or improve it, never regress it.**
 *
 * `.dev/perf/gate.ts` is the one-command form of this; run `compare.ts` directly when you
 * already have two reports and want to inspect the diff.
 *
 * @example Gate the current tree against the committed baseline
 * ```sh
 * bun run tests/perf/run.ts --out /tmp/current.json
 * bun run .dev/perf/compare.ts tests/perf/results/baseline.json /tmp/current.json
 * ```
 *
 * @example Loosen the threshold on a noisy machine
 * ```sh
 * bun run .dev/perf/compare.ts baseline.json current.json --threshold 15
 * ```
 *
 * ## Why a scenario is only flagged past a noise band
 *
 * Every measurement carries a margin of error. Comparing two medians directly would flag
 * ordinary jitter as a regression and train everyone to ignore the gate. A scenario is
 * therefore only a regression when the slowdown exceeds `--threshold` **plus** the margin
 * of error of both runs — so the gate fires on real, reproducible slowdowns.
 * @module
 */

import type { PerfReport, ScenarioResult } from "../../tests/perf/_harness.ts";
import { formatNs } from "../../tests/perf/_harness.ts";

/** How one scenario changed between two reports. */
export interface Comparison {
  name: string;
  group: string;
  baseline: ScenarioResult;
  current: ScenarioResult;
  /** Percentage change in per-unit cost: positive is slower, negative is faster. */
  deltaPct: number;
  /** Speedup factor (`baseline / current`): `>1` is faster, `<1` is slower. */
  speedup: number;
  /** Noise band in percentage points: `threshold + both runs' margins of error`. */
  tolerancePct: number;
  verdict: "regression" | "improvement" | "unchanged";
}

/**
 * Reads and validates a report file.
 *
 * @param path Path to a {@linkcode PerfReport} JSON file.
 * @return The parsed report.
 * @throws {Error} If the file is unreadable, is not JSON, or carries a different schema version.
 */
export async function readReport(path: string): Promise<PerfReport> {
  let report: PerfReport;
  try {
    report = JSON.parse(await Bun.file(path).text());
  } catch (error) {
    throw new Error(`Could not read perf report ${path}: ${error instanceof Error ? error.message : error}`);
  }
  if (report.schema !== 1) {
    throw new Error(
      `Perf report ${path} has schema ${report.schema}, expected 1. ` +
        `Re-record the baseline with the current harness.`,
    );
  }
  return report;
}

/** Reads a `--flag value` pair from the argument list. */
function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/**
 * Compares two reports.
 *
 * @param baseline The reference report.
 * @param current The report under test.
 * @param thresholdPct Slowdown allowed on top of measurement noise, in percent.
 * @return Per-scenario comparisons, plus scenarios missing from or new to `current`.
 */
export function compareReports(
  baseline: PerfReport,
  current: PerfReport,
  thresholdPct: number,
): { comparisons: Comparison[]; missing: string[]; added: string[] } {
  const currentByName = new Map(current.scenarios.map((s) => [s.name, s]));
  const baselineByName = new Map(baseline.scenarios.map((s) => [s.name, s]));

  const comparisons: Comparison[] = [];
  const missing: string[] = [];

  for (const base of baseline.scenarios) {
    const cur = currentByName.get(base.name);
    if (!cur) {
      missing.push(base.name);
      continue;
    }
    const deltaPct = ((cur.nsPerUnit - base.nsPerUnit) / base.nsPerUnit) * 100;
    const tolerancePct = thresholdPct + base.rme + cur.rme;
    comparisons.push({
      name: base.name,
      group: base.group,
      baseline: base,
      current: cur,
      deltaPct,
      speedup: base.nsPerUnit / cur.nsPerUnit,
      tolerancePct,
      verdict: deltaPct > tolerancePct ? "regression" : deltaPct < -tolerancePct ? "improvement" : "unchanged",
    });
  }

  const added = current.scenarios.filter((s) => !baselineByName.has(s.name)).map((s) => s.name);
  return { comparisons, missing, added };
}

/** Result of {@linkcode compareReports}. */
export type ComparisonResult = ReturnType<typeof compareReports>;

/**
 * Renders the human-readable comparison: run metadata, the per-scenario table, and totals.
 *
 * Shared with `.dev/perf/gate.ts` so both entry points report identically.
 *
 * @param baseline The reference report.
 * @param current The report under test.
 * @param result The output of {@linkcode compareReports} for those two reports.
 * @param thresholdPct The threshold the comparison was made with, for the header.
 * @return The report as a multi-line string, without a trailing newline.
 */
export function renderComparison(
  baseline: PerfReport,
  current: PerfReport,
  result: ComparisonResult,
  thresholdPct: number,
): string {
  const { comparisons, added } = result;
  const lines: string[] = ["# Performance comparison", ""];

  const stamp = (report: PerfReport): string =>
    `${report.meta.commit.slice(0, 8)}${report.meta.dirty ? " (dirty)" : ""}  ${report.meta.label ?? ""}`;
  lines.push(`baseline  ${stamp(baseline)}`, `current   ${stamp(current)}`);
  lines.push(`threshold ${thresholdPct}% + measurement noise`, "");

  // Comparing across machines or runtimes is the most common way to read a false regression.
  if (baseline.meta.cpu !== current.meta.cpu || baseline.meta.runtime !== current.meta.runtime) {
    lines.push(
      `! Environment differs between runs, so timings are not strictly comparable:`,
      `    baseline: ${baseline.meta.cpu} / ${baseline.meta.runtime}`,
      `    current:  ${current.meta.cpu} / ${current.meta.runtime}`,
      "",
    );
  }

  const symbol = { regression: "REGRESS", improvement: "FASTER ", unchanged: "same   " } as const;
  const head = ["", "scenario", "baseline", "current", "change", "speedup"];
  const body = comparisons.map((c) => [
    symbol[c.verdict],
    c.name,
    formatNs(c.baseline.nsPerUnit),
    formatNs(c.current.nsPerUnit),
    `${c.deltaPct >= 0 ? "+" : ""}${c.deltaPct.toFixed(1)}%`,
    `${c.speedup.toFixed(2)}x`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const pad = (row: string[]): string =>
    row
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  lines.push(pad(head), widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of body) lines.push(pad(row));

  const regressions = comparisons.filter((c) => c.verdict === "regression").length;
  const improvements = comparisons.filter((c) => c.verdict === "improvement").length;
  lines.push(
    "",
    `${comparisons.length} compared: ${improvements} faster, ${regressions} regressed, ` +
      `${comparisons.length - improvements - regressions} unchanged`,
  );

  if (added.length > 0) lines.push("", `New scenarios (no baseline yet): ${added.join(", ")}`);

  return lines.join("\n");
}

/**
 * Renders the failure detail for a gate run: one line per regressed scenario, plus the
 * rename hint when baseline scenarios are missing.
 *
 * Shared with `.dev/perf/gate.ts`.
 *
 * @param result The output of {@linkcode compareReports}.
 * @return The failure detail, or `""` when the comparison passed.
 */
export function renderFailure(result: ComparisonResult): string {
  const { comparisons, missing } = result;
  const lines: string[] = [];

  // A scenario that vanished is a gate failure: it usually means a rename, which would
  // otherwise silently drop a hot path out of coverage.
  if (missing.length > 0) {
    lines.push(
      `FAIL: ${missing.length} baseline scenario(s) absent from the current run: ${missing.join(", ")}`,
      `If a scenario was intentionally renamed or removed, re-record the baseline in the same commit.`,
    );
  }

  const regressions = comparisons.filter((c) => c.verdict === "regression");
  if (regressions.length > 0) {
    lines.push(`FAIL: ${regressions.length} performance regression(s):`);
    for (const r of regressions) {
      lines.push(
        `  ${r.name}: ${formatNs(r.baseline.nsPerUnit)} -> ${formatNs(r.current.nsPerUnit)} ` +
          `(+${r.deltaPct.toFixed(1)}%, tolerance ${r.tolerancePct.toFixed(1)}%)  ${r.current.description}`,
      );
    }
  }

  return lines.join("\n");
}

/** True when the comparison must fail the build: a regression, or a scenario that vanished. */
export function isFailure(result: ComparisonResult): boolean {
  return result.missing.length > 0 || result.comparisons.some((c) => c.verdict === "regression");
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

  if (positional.length < 2) {
    console.error(
      "usage: bun run .dev/perf/compare.ts <baseline.json> <current.json> [--threshold 10] [--json out.json]",
    );
    process.exit(2);
  }

  const [baselinePath, currentPath] = positional;
  const thresholdPct = Number(flag(args, "threshold") ?? 10);
  if (!Number.isFinite(thresholdPct) || thresholdPct < 0) {
    console.error(`--threshold must be a non-negative number, got ${flag(args, "threshold")}`);
    process.exit(2);
  }

  const baseline = await readReport(baselinePath);
  const current = await readReport(currentPath);
  const result = compareReports(baseline, current, thresholdPct);

  console.log(renderComparison(baseline, current, result, thresholdPct));

  const jsonOut = flag(args, "json");
  if (jsonOut) {
    await Bun.write(
      jsonOut,
      `${JSON.stringify(
        {
          baseline: baseline.meta,
          current: current.meta,
          thresholdPct,
          comparisons: result.comparisons.map(({ baseline: b, current: c, ...rest }) => ({
            ...rest,
            baselineNsPerUnit: b.nsPerUnit,
            currentNsPerUnit: c.nsPerUnit,
            unit: b.unit,
            description: b.description,
          })),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nWrote ${jsonOut}`);
  }

  if (isFailure(result)) {
    console.error(`\n${renderFailure(result)}`);
    process.exit(1);
  }

  console.log("\nPASS: no performance regressions.");
}
