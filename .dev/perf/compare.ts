/**
 * Zero-performance-regression gate.
 *
 * Compares perf reports scenario-by-scenario and exits non-zero if any scenario got
 * materially slower. This is the enforcement point for the project's policy:
 * **a change may keep performance the same or improve it, never regress it.**
 *
 * `.dev/perf/gate.ts` is the one-command form of this (one baseline report vs. one current
 * report); run `compare.ts` directly when you already have reports and want to inspect the
 * diff, or to compare several paired rounds the way CI does.
 *
 * @example Gate two single reports
 * ```sh
 * bun run tests/perf/run.ts --out /tmp/current.json
 * bun run .dev/perf/compare.ts tests/perf/results/baseline.json /tmp/current.json
 * ```
 *
 * @example Compare three paired rounds, as measured by the CI perf gate
 * ```sh
 * bun run .dev/perf/compare.ts base-1.json base-2.json base-3.json --vs head-1.json head-2.json head-3.json
 * ```
 *
 * @example Loosen the threshold on a noisy machine
 * ```sh
 * bun run .dev/perf/compare.ts baseline.json current.json --threshold 15
 * ```
 *
 * ## The paired-round estimator
 *
 * CI measures `n` paired rounds (n = 3): round *i* runs the head revision and the base
 * revision back to back on the same runner, alternating which side runs first —
 * (head, base), (base, head), (head, base). Pairing is what makes the comparison
 * meaningful: runner load drifts over minutes, and a drift that slows round 2 slows BOTH
 * sides of round 2, so it cancels in the per-round ratio; alternating the order cancels
 * any trend within a round. Per scenario, with all `n` rounds on both sides (a round that
 * omits a scenario fails the gate — see "Input validation"):
 *
 * ```
 * r_i = ln(head_i / base_i)      per-round log-ratio
 * m   = median(r_1 … r_n)        robust location — one bad round moves the edges, not
 *                                the centre (with n = 3 the median IS one of the good
 *                                rounds even when another round is a 10x outlier)
 * w   = max_i |r_i − m|          between-round half-width; with n = 3 this is the
 *                                distance to the farthest round — deliberately the most
 *                                conservative band the data supports
 * ```
 *
 * Log space because timing ratios are multiplicative: a 20% slowdown and a 20% speedup sit
 * the same distance from 0, and the estimate is invariant to which revision is called
 * "base". Reported in percent:
 *
 * ```
 * change = (e^m − 1)·100,   band = [ (e^{m−w} − 1)·100, (e^{m+w} − 1)·100 ]
 * ```
 *
 * Verdicts:
 *
 * - **regression** only when the WHOLE band sits above the noise floor — the lower bound
 *   exceeds `threshold + median(rme_base) + median(rme_head)`, the within-run sampling
 *   error of both sides (the harness' per-run 95% relative margins of error);
 * - **improvement** only when the upper bound is below `−threshold`;
 * - otherwise **unchanged**.
 *
 * A single contaminated round (a neighbour VM stealing CPU for one run) inflates `w`
 * instead of shifting `m`, so it widens the band into an "unchanged" verdict rather than
 * fabricating a regression.
 *
 * This replaces an earlier design that merged each revision's runs by per-scenario
 * MINIMUM and compared the two minima. Independent minima are downward-biased on both
 * sides and discard the pairing: real CI data (head runs 271.85/274.47/239.41 µs vs.
 * base runs 273.86/273.38/270.46 µs) had the minima claim an 11.5% speedup while every
 * paired ratio sat within noise of 1.0. With a single report per side the estimator
 * degenerates gracefully: the band is a point and the verdict reduces to comparing the
 * delta against the threshold plus both runs' margins of error.
 *
 * ## What the table shows
 *
 * The baseline/current columns show the REPRESENTATIVE PAIR: the actual round whose
 * log-ratio is the median (for even `n`, the round closest to it), so the displayed values
 * always reproduce `deltaPct` and the band. Picking each side's display value
 * independently could show a baseline→current pair that flatly contradicts the median
 * ratio the verdict is computed from. Single-run sides have no round structure, so they
 * render the ratio verdict only (an em dash in the value columns).
 *
 * ## Input validation
 *
 * The estimate is only as good as the pairing, so malformed input FAILS the gate
 * (collected in `failures`, surfaced by `renderFailure` and `isFailure`) instead of
 * silently degrading:
 *
 * - every round of a side must measure the same scenario set — a round that omits a
 *   scenario would otherwise shrink that scenario's estimate to fewer pairs, destroying
 *   the robustness the paired design promises;
 * - a scenario's identity (`group`, `unit`, `description`) must be constant across rounds
 *   and sides — a change signals a renamed or repurposed scenario, i.e. a different
 *   measurement, not a comparable one;
 * - round files must come from one suite: schema 1, and (with 2+ rounds) labels of the
 *   form `<stem>-<round>` with a single stem per side and round numbers in measurement
 *   order — anything else looks like files from different suites or in the wrong order.
 *
 * Scenarios present on the base side but entirely absent from the current side keep the
 * `missing` semantics (failure — usually a rename); scenarios new to the current side
 * stay informational (`added`).
 * @module
 */

import type { PerfReport, ScenarioResult } from "../../tests/perf/_harness.ts";
import { formatNs } from "../../tests/perf/_harness.ts";

/** How one scenario changed between the base and current runs. */
export interface Comparison {
  name: string;
  group: string;
  /**
   * The representative base measurement: the median round's base run when
   * {@linkcode Comparison.representativeRound} is set, otherwise the single base run.
   */
  baseline: ScenarioResult;
  /** The representative current measurement (same rule as {@linkcode Comparison.baseline}). */
  current: ScenarioResult;
  /** Median paired change in per-unit cost, in percent: positive is slower, negative is faster. */
  deltaPct: number;
  /** Median paired speedup (`base / current`): `>1` is faster, `<1` is slower. */
  speedup: number;
  /** Lower bound of the paired band, in percent (see the module doc for the estimator). */
  lowerPct: number;
  /** Upper bound of the paired band, in percent. */
  upperPct: number;
  /** Noise floor in percentage points: `threshold + both sides' median margins of error`. */
  tolerancePct: number;
  /** Number of paired rounds the estimate is computed from. */
  rounds: number;
  /**
   * 1-based index of the round whose log-ratio is the median — the pair the table shows,
   * so values, `deltaPct` and band always agree. `undefined` for single-run sides, which
   * have no round structure and render ratio-only.
   */
  representativeRound?: number;
  verdict: "regression" | "improvement" | "unchanged";
}

/** The outcome of comparing two sets of runs; see {@linkcode comparePairedReports}. */
export interface ComparisonResult {
  comparisons: Comparison[];
  /** Base-side scenarios entirely absent from the current side (failure — usually a rename). */
  missing: string[];
  /** Current-side scenarios with no base counterpart (informational). */
  added: string[];
  /** Input-validation failures: partial rounds, identity drift, mixed suite files. */
  failures: string[];
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

/** Median of a non-empty list. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Formats a signed percentage with a fixed number of decimals. */
function signedPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/**
 * Compares paired rounds of two revisions.
 *
 * `baselineRuns[i]` is paired with `currentRuns[i]`: the CI workflow measures round *i* of
 * both revisions back to back, so the per-round ratio cancels runner drift (see the module
 * doc for the estimator and for the validation rules that fail malformed input). Extra
 * runs on the longer side are ignored.
 *
 * @param baselineRuns Reports of the reference revision, in round order.
 * @param currentRuns Reports of the revision under test, in round order.
 * @param thresholdPct Slowdown allowed on top of measurement noise, in percent.
 * @return Per-scenario comparisons, missing/added scenarios, and validation failures.
 * @throws {Error} If either side has no reports.
 */
export function comparePairedReports(
  baselineRuns: readonly PerfReport[],
  currentRuns: readonly PerfReport[],
  thresholdPct: number,
): ComparisonResult {
  if (baselineRuns.length === 0 || currentRuns.length === 0) {
    throw new Error("comparePairedReports needs at least one report per side");
  }
  const rounds = Math.min(baselineRuns.length, currentRuns.length);
  const sides = [
    { name: "base", runs: baselineRuns.slice(0, rounds) },
    { name: "current", runs: currentRuns.slice(0, rounds) },
  ] as const;
  const failures: string[] = [];

  // --- Suite-identity guards: the round files must come from one suite, in order --------
  for (const side of sides) {
    for (const [i, run] of side.runs.entries()) {
      if (run.schema !== 1) {
        failures.push(
          `${side.name} round ${i + 1} has schema ${run.schema}, expected 1 — ` +
            `re-record the reports with the current harness.`,
        );
      }
    }
    if (rounds >= 2) {
      const labels = side.runs.map((r) => r.meta.label);
      if (labels.every((label) => label !== undefined)) {
        const parsed = labels.map((label) => /^(.*)-(\d+)$/.exec(label as string));
        const stems = new Set(parsed.map((p) => p?.[1]));
        const badPattern = labels.findIndex((_, i) => parsed[i] === null);
        if (badPattern >= 0) {
          failures.push(
            `${side.name} round ${badPattern + 1} carries label ${JSON.stringify(labels[badPattern])} that does not ` +
              `match the "<stem>-<round>" pattern of the other runs — the round files look like different suites.`,
          );
        } else if (stems.size > 1) {
          failures.push(
            `${side.name} runs mix label stems (${[...stems].join(", ")}) — ` +
              `the round files must come from one suite, labelled <stem>-1 .. <stem>-${rounds}.`,
          );
        } else {
          const misordered = parsed.findIndex((p, i) => Number(p?.[2]) !== i + 1);
          if (misordered >= 0) {
            failures.push(
              `${side.name} round ${misordered + 1} carries label ${JSON.stringify(labels[misordered])} — ` +
                `round files must be passed in measurement order (<stem>-1 .. <stem>-${rounds}).`,
            );
          }
        }
      } else if (labels.some((label) => label !== undefined)) {
        failures.push(
          `${side.name} runs are inconsistently labelled (${labels.map((l) => JSON.stringify(l)).join(", ")}) — ` +
            `either every round carries a "<stem>-<round>" label or none does.`,
        );
      }
    }
  }

  const byName = (report: PerfReport): Map<string, ScenarioResult> => new Map(report.scenarios.map((s) => [s.name, s]));
  const mapsByRound = sides.map((side) => side.runs.map(byName));
  const orders = sides.map((side) => [...new Set(side.runs.flatMap((r) => r.scenarios.map((s) => s.name)))]);

  // --- Per-side scenario-set consistency: no round may omit a scenario ------------------
  const partial = new Set<string>(); // "<sideIndex>:<name>" already failed above the pair loop
  for (const [si, side] of sides.entries()) {
    for (const name of orders[si]) {
      const absentRounds: number[] = [];
      for (let i = 0; i < rounds; i++) {
        if (!mapsByRound[si][i].has(name)) absentRounds.push(i + 1);
      }
      if (absentRounds.length > 0) {
        partial.add(`${si}:${name}`);
        failures.push(
          `scenario ${JSON.stringify(name)} is absent from ${side.name} round(s) ${absentRounds.join(", ")} — ` +
            `every round of a side must measure the same scenario set; a partial round must fail, ` +
            `not shrink the paired estimate.`,
        );
      }
    }
  }

  const comparisons: Comparison[] = [];
  const missing: string[] = [];
  const headNames = new Set(orders[1]);

  for (const name of orders[0]) {
    if (partial.has(`0:${name}`) || partial.has(`1:${name}`)) continue; // already failed above
    if (!headNames.has(name)) {
      // Not measurable in the current runs at all — usually a rename, which must fail loudly.
      missing.push(name);
      continue;
    }
    const pairs: { base: ScenarioResult; head: ScenarioResult }[] = [];
    for (let i = 0; i < rounds; i++) {
      pairs.push({
        base: mapsByRound[0][i].get(name) as ScenarioResult,
        head: mapsByRound[1][i].get(name) as ScenarioResult,
      });
    }

    // --- Identity: a scenario's group/unit/description may not drift between rounds or sides
    let identityFailed = false;
    for (const field of ["group", "unit", "description"] as const) {
      const expected = pairs[0].base[field];
      for (const [i, pair] of pairs.entries()) {
        const offender =
          pair.base[field] !== expected
            ? { side: "base", got: pair.base[field] }
            : pair.head[field] !== expected
              ? { side: "current", got: pair.head[field] }
              : undefined;
        if (offender) {
          identityFailed = true;
          failures.push(
            `scenario ${JSON.stringify(name)} has ${field} ${JSON.stringify(offender.got)} in ${offender.side} ` +
              `round ${i + 1} but ${JSON.stringify(expected)} elsewhere — a renamed or repurposed scenario ` +
              `must fail the gate, not compare.`,
          );
          break; // one message per field is enough
        }
      }
    }
    if (identityFailed) continue;

    const logRatios = pairs.map((p) => Math.log(p.head.nsPerUnit / p.base.nsPerUnit));
    const m = median(logRatios);
    const w = Math.max(...logRatios.map((r) => Math.abs(r - m)));
    const deltaPct = (Math.exp(m) - 1) * 100;
    const lowerPct = (Math.exp(m - w) - 1) * 100;
    const upperPct = (Math.exp(m + w) - 1) * 100;
    const tolerancePct = thresholdPct + median(pairs.map((p) => p.base.rme)) + median(pairs.map((p) => p.head.rme));

    // Representative pair for the table: the actual round whose log-ratio is the median
    // (for even n, the closest round to it), so the displayed baseline/current always
    // reproduce deltaPct and the band. Single-run sides get no representative pair —
    // there is no round structure to point at, and they render ratio-only.
    let representativeRound: number | undefined;
    let representative: { base: ScenarioResult; head: ScenarioResult } | undefined;
    if (pairs.length >= 2) {
      let best = 0;
      for (let i = 1; i < pairs.length; i++) {
        if (Math.abs(logRatios[i] - m) < Math.abs(logRatios[best] - m)) best = i;
      }
      representative = pairs[best];
      representativeRound = best + 1;
    }

    comparisons.push({
      name,
      group: pairs[0].base.group,
      baseline: representative?.base ?? pairs[0].base,
      current: representative?.head ?? pairs[0].head,
      deltaPct,
      speedup: Math.exp(-m),
      lowerPct,
      upperPct,
      tolerancePct,
      rounds: pairs.length,
      ...(representativeRound !== undefined ? { representativeRound } : {}),
      verdict: lowerPct > tolerancePct ? "regression" : upperPct < -thresholdPct ? "improvement" : "unchanged",
    });
  }

  const baseNames = new Set(orders[0]);
  const added = orders[1].filter((n) => !baseNames.has(n) && !partial.has(`1:${n}`));
  return { comparisons, missing, added, failures };
}

/**
 * Compares two single reports — the one-round form of {@linkcode comparePairedReports}.
 *
 * With one run per side the band is a point, so the verdict reduces to comparing the delta
 * against `threshold + both runs' margins of error`. This is what `.dev/perf/gate.ts` uses
 * for the committed-baseline comparison on one machine.
 *
 * @param baseline The reference report.
 * @param current The report under test.
 * @param thresholdPct Slowdown allowed on top of measurement noise, in percent.
 * @return Per-scenario comparisons, missing/added scenarios, and validation failures.
 */
export function compareReports(baseline: PerfReport, current: PerfReport, thresholdPct: number): ComparisonResult {
  return comparePairedReports([baseline], [current], thresholdPct);
}

/**
 * Renders the human-readable comparison: run metadata, the per-scenario table, and totals.
 *
 * Each side is one report or, for a paired comparison, one report per round. Shared with
 * `.dev/perf/gate.ts` so both entry points report identically.
 *
 * @param baseline The reference report(s), in round order.
 * @param current The report(s) under test, in round order.
 * @param result The output of {@linkcode comparePairedReports} for those reports.
 * @param thresholdPct The threshold the comparison was made with, for the header.
 * @return The report as a multi-line string, without a trailing newline.
 */
export function renderComparison(
  baseline: PerfReport | readonly PerfReport[],
  current: PerfReport | readonly PerfReport[],
  result: ComparisonResult,
  thresholdPct: number,
): string {
  const baseRuns = "scenarios" in baseline ? [baseline] : baseline;
  const headRuns = "scenarios" in current ? [current] : current;
  const { comparisons, added } = result;
  const lines: string[] = ["# Performance comparison", ""];

  const stamp = (report: PerfReport): string =>
    `${report.meta.commit.slice(0, 8)}${report.meta.dirty ? " (dirty)" : ""}  ${report.meta.label ?? ""}`;
  lines.push(`baseline  ${stamp(baseRuns[0])}`, `current   ${stamp(headRuns[0])}`);
  if (baseRuns.length > 1 || headRuns.length > 1) {
    lines.push(`rounds    ${Math.min(baseRuns.length, headRuns.length)} paired`);
  }
  lines.push(`threshold ${thresholdPct}% + measurement noise`);
  if (comparisons.length > 0) {
    // All comparisons share the round count, so the first one speaks for the table.
    lines.push(
      comparisons[0].representativeRound !== undefined
        ? `values    baseline/current show the median round's measured pair for each scenario`
        : `values    single run per side — verdict from the ratio alone, no round pair to show`,
    );
  }
  lines.push("");

  // Comparing across machines or runtimes is the most common way to read a false regression.
  const allRuns = [...baseRuns, ...headRuns];
  if (new Set(allRuns.map((r) => r.meta.cpu)).size > 1 || new Set(allRuns.map((r) => r.meta.runtime)).size > 1) {
    lines.push(
      `! Environment differs between runs, so timings are not strictly comparable:`,
      `    baseline: ${baseRuns[0].meta.cpu} / ${baseRuns[0].meta.runtime}`,
      `    current:  ${headRuns[0].meta.cpu} / ${headRuns[0].meta.runtime}`,
      "",
    );
  }

  const symbol = { regression: "REGRESS", improvement: "FASTER ", unchanged: "same   " } as const;
  const head = ["", "scenario", "baseline", "current", "change", "band"];
  const body = comparisons.map((c) => [
    symbol[c.verdict],
    c.name,
    c.representativeRound !== undefined ? formatNs(c.baseline.nsPerUnit) : "—",
    c.representativeRound !== undefined ? formatNs(c.current.nsPerUnit) : "—",
    signedPct(c.deltaPct),
    `[${signedPct(c.lowerPct)}, ${signedPct(c.upperPct)}]`,
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
 * Renders the failure detail for a gate run: input-validation failures, one line per
 * regressed scenario, plus the rename hint when baseline scenarios are missing.
 *
 * Shared with `.dev/perf/gate.ts`.
 *
 * @param result The output of {@linkcode comparePairedReports}.
 * @return The failure detail, or `""` when the comparison passed.
 */
export function renderFailure(result: ComparisonResult): string {
  const { comparisons, missing, failures } = result;
  const lines: string[] = [];

  if (failures.length > 0) {
    lines.push(`FAIL: ${failures.length} invalid measurement(s):`);
    for (const failure of failures) lines.push(`  ${failure}`);
  }

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
          `(${signedPct(r.deltaPct)}, band [${signedPct(r.lowerPct)}, ${signedPct(r.upperPct)}], ` +
          `tolerance ${r.tolerancePct.toFixed(1)}%)  ${r.current.description}`,
      );
    }
  }

  return lines.join("\n");
}

/** True when the comparison must fail the build: invalid input, a regression, or a vanished scenario. */
export function isFailure(result: ComparisonResult): boolean {
  return (
    result.failures.length > 0 ||
    result.missing.length > 0 ||
    result.comparisons.some((c) => c.verdict === "regression")
  );
}

/**
 * Explains why two reports cannot be compared, or `undefined` when they can.
 *
 * These scenarios measure between 9 ns and 600 µs per unit. A different CPU or JS engine shifts
 * every one of those numbers by a multiple, which swamps the regression threshold and turns the
 * whole comparison into noise — reporting either a page of phantom regressions or, worse, hiding a
 * real one behind a machine that happens to be faster.
 *
 * This is a hard error rather than a warning on purpose: a warning above a table of red rows still
 * gets read as "the gate is broken again", which is how a perf gate stops being trusted. Two
 * revisions must be measured on the same machine, in the same run, to be comparable at all.
 */
export function incomparableReason(baseline: PerfReport, current: PerfReport): string | undefined {
  const fields: [string, string, string][] = [
    ["CPU", baseline.meta.cpu, current.meta.cpu],
    ["OS", baseline.meta.os, current.meta.os],
    ["runtime", baseline.meta.runtime, current.meta.runtime],
  ];
  const differing = fields.filter(([, a, b]) => a !== b);
  if (differing.length === 0) return undefined;

  return [
    `Refusing to compare: the two runs were measured in different environments.`,
    ...differing.map(([name, a, b]) => `  ${name}: baseline ${JSON.stringify(a)} vs current ${JSON.stringify(b)}`),
    ``,
    `Measure both revisions on the same machine in the same run. In CI, check out the base commit`,
    `and the head commit on one runner and compare those two reports; do not compare against a`,
    `baseline recorded elsewhere. Pass --allow-environment-mismatch to override for a rough look.`,
  ].join("\n");
}

const USAGE = `usage:
  bun run .dev/perf/compare.ts <baseline.json> <current.json> [--threshold 10] [--json out.json]
  bun run .dev/perf/compare.ts <base-1.json> <base-2.json> ... --vs <head-1.json> <head-2.json> ... [--threshold 10]

The --vs form compares paired rounds: base-i is paired with head-i, so both lists must have
the same length and be in the order the rounds were measured.`;

if (import.meta.main) {
  const args = Bun.argv.slice(2);

  // Split positionals at --vs; value-taking flags are skipped together with their values.
  const VALUE_FLAGS = new Set(["--threshold", "--json"]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("--") && arg !== "--vs") continue; // boolean flags
    positional.push(arg);
  }
  const sep = positional.indexOf("--vs");
  const baselinePaths = sep >= 0 ? positional.slice(0, sep) : positional.slice(0, 1);
  const currentPaths = sep >= 0 ? positional.slice(sep + 1) : positional.slice(1);

  if (
    currentPaths.length === 0 ||
    baselinePaths.length !== currentPaths.length ||
    (sep < 0 && positional.length !== 2)
  ) {
    console.error(
      sep >= 0 && baselinePaths.length !== currentPaths.length && currentPaths.length > 0
        ? `Paired comparison needs the same number of reports on both sides of --vs ` +
            `(got ${baselinePaths.length} base vs ${currentPaths.length} current).\n\n${USAGE}`
        : USAGE,
    );
    process.exit(2);
  }

  const thresholdPct = Number(flag(args, "threshold") ?? 10);
  if (!Number.isFinite(thresholdPct) || thresholdPct < 0) {
    console.error(`--threshold must be a non-negative number, got ${flag(args, "threshold")}`);
    process.exit(2);
  }

  const baselineRuns = await Promise.all(baselinePaths.map(readReport));
  const currentRuns = await Promise.all(currentPaths.map(readReport));

  for (let i = 0; i < baselineRuns.length; i++) {
    const incomparable = incomparableReason(baselineRuns[i], currentRuns[i]);
    if (incomparable && !args.includes("--allow-environment-mismatch")) {
      console.error(incomparable);
      process.exit(2);
    }
  }

  const result = comparePairedReports(baselineRuns, currentRuns, thresholdPct);

  console.log(renderComparison(baselineRuns, currentRuns, result, thresholdPct));

  const jsonOut = flag(args, "json");
  if (jsonOut) {
    await Bun.write(
      jsonOut,
      `${JSON.stringify(
        {
          baseline: baselineRuns.map((r) => r.meta),
          current: currentRuns.map((r) => r.meta),
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
