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
 * Verdicts (MAJORITY rule, with a fail-closed inconclusive case):
 *
 * - each round is checked against the verdict lines on its own: `r_i > ln(1 + tol/100)`
 *   for regression — tol being `threshold + median(rme_base) + median(rme_head)`, the
 *   noise floor — and `r_i < ln(1 − threshold/100)` for improvement. A MAJORITY of rounds
 *   agreeing past a line decides the verdict (2 of 3; the single round when n = 1, which
 *   reproduces the one-round gate semantics). Requiring the whole band to clear the line
 *   instead would let one quiet round wave a consistent regression through — the median
 *   ± max-deviation band is retained for DISPLAY;
 * - FAIL-CLOSED exception: when the spread is extreme (`w > ln 2` — the band spans more
 *   than a 2x factor around the median, a 4x total range) AND a majority agrees on a
 *   verdict, the measurement is too noisy to trust either answer: one contaminated round
 *   is masking the majority (e.g. head 120/120/1 vs base 100/100/100: two rounds regress
 *   +20%, but the band spans [−99%, +14300%]). The scenario FAILS with the spread named
 *   and a rerun instruction — an inconclusive measurement must not wave a real
 *   regression through. With no majority agreement there is nothing to mask, so a lone
 *   outlier round (head 100/100/1000) still degrades to "unchanged", not a failure.
 *
 * A single contaminated round (a neighbour VM stealing CPU for one run) inflates `w`
 * instead of shifting `m`, so it widens the band into an "unchanged" verdict rather than
 * fabricating a regression.
 *
 * What this is NOT: a confidence interval. `rme` is the harness' per-run Student-t margin
 * of the sample MEAN, used here only as a sampling-noise magnitude — the headline
 * statistic is a median, so no valid 95% coverage claim attaches to adding those margins.
 * In short: band = median ± max round deviation, noise floor = threshold + per-side
 * sampling margins — an intentionally conservative heuristic, not a statistical
 * confidence calculation.
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
 * log-ratio is the median, so the displayed values always reproduce `deltaPct` and the
 * band. Paired mode requires an ODD round count (the CI workflow measures 3): with an
 * even count the median would fall between two rounds and no measured pair could
 * represent it. Picking each side's display value independently could show a
 * baseline→current pair that flatly contradicts the median ratio the verdict is computed
 * from. A single run per side is a real pair too: its measured values are shown, and the
 * band is a point.
 *
 * ## Input validation
 *
 * The estimate is only as good as the pairing, so malformed input FAILS the gate
 * (collected in `failures`, surfaced by `renderFailure` and `isFailure`) instead of
 * silently degrading. Before any of that, every report passes structural validation
 * (`assertReportStructure`): schema and full meta shape (commit, dirty, os, date, cpu,
 * runtime), unique non-empty scenario names, non-empty identity strings, finite-positive
 * costs, positive-integer sampling parameters, finite ORDERED percentiles
 * (min ≤ p50 ≤ p75 ≤ p99 ≤ max, as the harness produces them), non-negative stddev and
 * margins — violations THROW (exit 2 in the CLI), because a report whose numbers are
 * 0/NaN/missing would turn the ratios into NaN and fall through to "unchanged" (a
 * fail-open). Then:
 *
 * - every round of a side must measure the same scenario set — a round that omits a
 *   scenario would otherwise shrink that scenario's estimate to fewer pairs, destroying
 *   the robustness the paired design promises;
 * - a scenario's identity (`group`, `unit`, `description`, `samples`, `iterations`,
 *   `unitsPerIteration`) must be constant across rounds and sides — a change signals a
 *   renamed or repurposed scenario, i.e. a different measurement, not a comparable one.
 *   This is checked over the UNION of scenario names: head-only ("added") scenarios are
 *   validated across their rounds too;
 * - a scenario's workload fingerprint (see `scenarioFingerprint` in the harness) must be
 *   identical wherever it is recorded — an edited scenario or workload is a different
 *   measurement;
 * - the SUITE fingerprint (`meta.suiteFingerprint`, a hash of the suite's source files —
 *   scenarios, fixtures, helpers, harness) must be identical on both sides: the base and
 *   head checkouts each run their own tests/perf code, so unchanged scenario metadata can
 *   still hide a workload edit. A mismatch fails closed on purpose — a PR that edits the
 *   suite changes what the gate measures and is flagged for explicit review;
 * - PRESENCE PARITY for both fingerprints: either every report carries them or none does.
 *   One fingerprinted side against an unfingerprinted one means the unfingerprinted side
 *   predates fingerprinting — that fails with a migration message unless the explicit
 *   transition grace `--allow-unfingerprinted-base` is given. Fail-closed is the default
 *   because a silently skipped equality gate is exactly how unequal workloads get
 *   compared;
 * - round files must come from one suite: schema 1, and (with 2+ rounds) every round
 *   labelled `<stem>-<round>` with a single stem per side and round numbers in
 *   measurement order — missing, mixed, or misordered labels look like files from
 *   different suites or in the wrong order.
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
  /** The representative base measurement: the median round's base run (round 1 when there is one round). */
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
  /** Noise floor in percentage points: `threshold + both sides' median sampling margins`. */
  tolerancePct: number;
  /** Number of paired rounds the estimate is computed from. */
  rounds: number;
  /**
   * 1-based index of the round whose log-ratio is the median — the pair the table shows,
   * so values, `deltaPct` and band always agree. A single run per side is a real pair
   * too, so this is always set (round 1 in that case).
   */
  representativeRound: number;
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

/** Identity fields that define WHAT a scenario measures; a change means a different measurement. */
const IDENTITY_FIELDS = ["group", "unit", "description", "samples", "iterations", "unitsPerIteration"] as const;

/**
 * Spread cap for a conclusive paired measurement, in log space: a band wider than a 2x
 * factor around the median (a 4x total range) cannot localize the ratio at all — if a
 * majority of rounds still agrees on a verdict, one contaminated round is masking it.
 */
const INCONCLUSIVE_HALF_WIDTH = Math.log(2);

/**
 * Structural validation of one report — fails CLOSED on input that cannot produce
 * meaningful numbers.
 *
 * This throws (a usage error: exit 2 in the CLI) rather than recording a comparison
 * failure, because input this broken is not a measurement at all. The motivating
 * fail-open: an `nsPerUnit` of 0, negative, missing, or NaN turns every log-ratio and
 * band into NaN, and NaN comparisons fall through every verdict branch to "unchanged" —
 * garbage would PASS the gate.
 *
 * @param report The report to validate.
 * @param side `"base"` or `"current"`, for the error message.
 * @param round 1-based round number, for the error message.
 * @throws {Error} Naming the round, scenario, and field that is malformed.
 */
function assertReportStructure(report: PerfReport, side: string, round: number): void {
  const where = `${side} round ${round}`;
  if (report.schema !== 1) {
    throw new Error(`${where}: schema ${report.schema}, expected 1 — re-record the reports with the current harness.`);
  }
  const meta = report.meta;
  if (typeof meta?.cpu !== "string" || meta.cpu.length === 0) {
    throw new Error(`${where}: meta.cpu must be a non-empty string, got ${JSON.stringify(meta?.cpu)}.`);
  }
  if (typeof meta.runtime !== "string" || meta.runtime.length === 0) {
    throw new Error(`${where}: meta.runtime must be a non-empty string, got ${JSON.stringify(meta?.runtime)}.`);
  }
  if (typeof meta.commit !== "string" || meta.commit.length === 0) {
    throw new Error(`${where}: meta.commit must be a non-empty string, got ${JSON.stringify(meta?.commit)}.`);
  }
  if (typeof meta.dirty !== "boolean") {
    throw new Error(`${where}: meta.dirty must be a boolean, got ${JSON.stringify(meta.dirty)}.`);
  }
  if (typeof meta.os !== "string" || meta.os.length === 0) {
    throw new Error(`${where}: meta.os must be a non-empty string, got ${JSON.stringify(meta.os)}.`);
  }
  if (typeof meta.date !== "string" || Number.isNaN(Date.parse(meta.date))) {
    throw new Error(`${where}: meta.date must be a valid date string, got ${JSON.stringify(meta.date)}.`);
  }
  if (meta.label !== undefined && (typeof meta.label !== "string" || meta.label.length === 0)) {
    throw new Error(`${where}: meta.label must be a non-empty string when present, got ${JSON.stringify(meta.label)}.`);
  }
  if (
    meta.suiteFingerprint !== undefined &&
    (typeof meta.suiteFingerprint !== "string" || meta.suiteFingerprint.length === 0)
  ) {
    throw new Error(
      `${where}: meta.suiteFingerprint must be a non-empty string when present, got ${JSON.stringify(meta.suiteFingerprint)}.`,
    );
  }
  if (!Array.isArray(report.scenarios) || report.scenarios.length === 0) {
    // An empty report compares nothing and would PASS vacuously — fail closed instead.
    throw new Error(`${where}: the report contains no scenarios.`);
  }
  const seen = new Set<string>();
  for (const scenario of report.scenarios) {
    if (typeof scenario.name !== "string" || scenario.name.length === 0) {
      throw new Error(`${where}: a scenario has a missing or empty name.`);
    }
    if (seen.has(scenario.name)) {
      throw new Error(
        `${where}: duplicate scenario name ${JSON.stringify(scenario.name)} — names join the two sides, ` +
          `so they must be unique within a report.`,
      );
    }
    seen.add(scenario.name);
    const at = `${where}, scenario ${JSON.stringify(scenario.name)}`;
    for (const field of ["group", "unit", "description"] as const) {
      if (typeof scenario[field] !== "string" || (scenario[field] as string).length === 0) {
        throw new Error(`${at}: ${field} must be a non-empty string, got ${JSON.stringify(scenario[field])}.`);
      }
    }
    for (const field of ["nsPerUnit", "unitsPerSec"] as const) {
      if (!Number.isFinite(scenario[field]) || (scenario[field] as number) <= 0) {
        throw new Error(`${at}: ${field} must be finite and positive, got ${JSON.stringify(scenario[field])}.`);
      }
    }
    for (const field of ["samples", "iterations", "unitsPerIteration"] as const) {
      if (!Number.isInteger(scenario[field]) || (scenario[field] as number) <= 0) {
        throw new Error(`${at}: ${field} must be a positive integer, got ${JSON.stringify(scenario[field])}.`);
      }
    }
    // Percentiles come from one sorted sample list in the harness, so they must be finite
    // and ordered; a violation means the file was not produced by this harness.
    for (const field of ["min", "p50", "p75", "p99", "max"] as const) {
      if (!Number.isFinite(scenario[field])) {
        throw new Error(`${at}: ${field} must be finite, got ${JSON.stringify(scenario[field])}.`);
      }
    }
    if (
      !(
        scenario.min <= scenario.p50 &&
        scenario.p50 <= scenario.p75 &&
        scenario.p75 <= scenario.p99 &&
        scenario.p99 <= scenario.max
      )
    ) {
      throw new Error(
        `${at}: percentiles must satisfy min <= p50 <= p75 <= p99 <= max, ` +
          `got ${[scenario.min, scenario.p50, scenario.p75, scenario.p99, scenario.max].join(" / ")}.`,
      );
    }
    if (!Number.isFinite(scenario.stddev) || scenario.stddev < 0) {
      throw new Error(`${at}: stddev must be finite and non-negative, got ${JSON.stringify(scenario.stddev)}.`);
    }
    if (!Number.isFinite(scenario.rme) || scenario.rme < 0) {
      throw new Error(`${at}: rme must be finite and non-negative, got ${JSON.stringify(scenario.rme)}.`);
    }
    if (
      scenario.fingerprint !== undefined &&
      (typeof scenario.fingerprint !== "string" || scenario.fingerprint.length === 0)
    ) {
      throw new Error(
        `${at}: fingerprint must be a non-empty string when present, got ${JSON.stringify(scenario.fingerprint)}.`,
      );
    }
  }
}

/**
 * Fails when a scenario's identity is not constant across all its occurrences.
 *
 * A change in any {@linkcode IDENTITY_FIELDS} field means a renamed, repurposed, or
 * re-parametrized scenario — a different measurement, not a comparable one. The workload
 * fingerprint (see `scenarioFingerprint` in the harness) must be identical wherever it is
 * recorded, and present on either every occurrence or none (presence parity — reports
 * written before fingerprints existed carry none and trip the parity check, not the
 * mismatch check).
 *
 * @param name The scenario name, for the message.
 * @param runs Every occurrence of the scenario, with its side and 1-based round.
 * @param allowUnfingerprintedBase Transition grace for the presence-parity check (see
 *   {@linkcode CompareOptions}); mismatches are never excused.
 * @return One failure message per drifted field, plus one for a fingerprint problem.
 */
function identityDrift(
  name: string,
  runs: readonly { side: string; round: number; scenario: ScenarioResult }[],
  allowUnfingerprintedBase = false,
): string[] {
  const failures: string[] = [];
  const first = runs[0].scenario;
  for (const field of IDENTITY_FIELDS) {
    const offender = runs.find((r) => r.scenario[field] !== first[field]);
    if (offender) {
      failures.push(
        `scenario ${JSON.stringify(name)} has ${field} ${JSON.stringify(offender.scenario[field])} in ${offender.side} ` +
          `round ${offender.round} but ${JSON.stringify(first[field])} elsewhere — a renamed or repurposed scenario ` +
          `must fail the gate, not compare.`,
      );
    }
  }

  const withPrint = runs.filter((r) => r.scenario.fingerprint !== undefined);
  if (withPrint.length > 0 && withPrint.length < runs.length) {
    // Presence parity: either every occurrence carries a fingerprint or none does. A clean
    // side split means one side predates fingerprinting (the rollout case); fingerprints
    // appearing in only SOME rounds of one side means files from different suite versions.
    const sidesWith = new Set(withPrint.map((r) => r.side));
    const mixedWithinSide = runs.some((r) => r.scenario.fingerprint === undefined && sidesWith.has(r.side));
    if (mixedWithinSide) {
      failures.push(
        `scenario ${JSON.stringify(name)}'s rounds disagree on carrying a workload fingerprint — ` +
          `the round files come from different suite versions; re-record them with one harness.`,
      );
    } else {
      // The grace covers ONE direction only: an old BASE missing fingerprints. A current
      // side without fingerprints means they were REMOVED — never the rollout case, never excused.
      const predating = runs.find((r) => r.scenario.fingerprint === undefined)?.side ?? "base";
      if (predating === "current") {
        failures.push(
          `scenario ${JSON.stringify(name)} has no workload fingerprint on the current side — ` +
            `removing fingerprints is not the rollout case and is never excused; re-record the current reports.`,
        );
      } else if (!allowUnfingerprintedBase) {
        failures.push(
          `scenario ${JSON.stringify(name)} has a workload fingerprint on one side but none on the base side — ` +
            `the base reports predate workload fingerprinting. Re-record them (or merge a base that contains ` +
            `fingerprints), or pass --allow-unfingerprinted-base during the transition.`,
        );
      }
    }
  }
  if (withPrint.length === runs.length && new Set(withPrint.map((r) => r.scenario.fingerprint)).size > 1) {
    failures.push(
      `scenario ${JSON.stringify(name)}'s workload fingerprint differs across rounds or revisions — ` +
        `the gate compares identical workloads; re-record the baseline in the same commit as an intentional change.`,
    );
  }
  return failures;
}

/** Options for {@linkcode comparePairedReports}. */
export interface CompareOptions {
  /**
   * Transition grace: reports recorded before workload fingerprinting existed carry no
   * fingerprints, so a pre-fingerprint base compared against a fingerprinted head would
   * otherwise fail the presence-parity check. This flag downgrades exactly that ONE
   * direction (base absent, current present) to a skip; fingerprints missing on the
   * CURRENT side mean they were removed and always fail, as do fingerprint mismatches
   * and mixed-version files. Fail-closed is the default on purpose: a silently skipped
   * equality gate is how unequal workloads get compared, so the transition cost is made
   * explicit instead.
   */
  allowUnfingerprintedBase?: boolean;
}

/**
 * Compares paired rounds of two revisions.
 *
 * `baselineRuns[i]` is paired with `currentRuns[i]`: the CI workflow measures round *i* of
 * both revisions back to back, so the per-round ratio cancels runner drift (see the module
 * doc for the estimator and for the validation rules that fail malformed input).
 *
 * @param baselineRuns Reports of the reference revision, in round order.
 * @param currentRuns Reports of the revision under test, in round order.
 * @param thresholdPct Slowdown allowed on top of measurement noise, in percent.
 * @param options See {@linkcode CompareOptions}.
 * @return Per-scenario comparisons, missing/added scenarios, and validation failures.
 * @throws {Error} If either side has no reports, the sides have different round counts
 *   (rounds pair by position, so truncating a longer side would silently change the
 *   input), the round count is even and greater than one — with an even count the median
 *   log-ratio falls BETWEEN two rounds and no actual round reproduces it, so paired mode
 *   requires an odd count (the CI workflow measures 3) — or any report is structurally
 *   malformed (see {@linkcode assertReportStructure}; broken numbers must not silently
 *   compare as "unchanged").
 */
export function comparePairedReports(
  baselineRuns: readonly PerfReport[],
  currentRuns: readonly PerfReport[],
  thresholdPct: number,
  options: CompareOptions = {},
): ComparisonResult {
  if (baselineRuns.length === 0 || currentRuns.length === 0) {
    throw new Error("comparePairedReports needs at least one report per side");
  }
  if (baselineRuns.length !== currentRuns.length) {
    throw new Error(
      `comparePairedReports needs the same number of rounds on both sides ` +
        `(got ${baselineRuns.length} base vs ${currentRuns.length} current) — round files pair by position.`,
    );
  }
  if (baselineRuns.length > 1 && baselineRuns.length % 2 === 0) {
    throw new Error(
      `comparePairedReports needs an odd round count in paired mode (got ${baselineRuns.length}) — ` +
        `with an even count the median log-ratio falls between two rounds and no measured pair represents it.`,
    );
  }
  const rounds = baselineRuns.length;
  const sides = [
    { name: "base", runs: baselineRuns },
    { name: "current", runs: currentRuns },
  ] as const;

  // Structural validation comes FIRST: input this broken is not a measurement at all.
  for (const side of sides) {
    for (const [i, run] of side.runs.entries()) {
      assertReportStructure(run, side.name, i + 1);
    }
  }

  const failures: string[] = [];

  // --- Suite-identity guards: the round files must come from one suite, in order --------
  for (const side of sides) {
    if (rounds >= 2) {
      const labels = side.runs.map((r) => r.meta.label);
      if (labels.some((label) => label === undefined)) {
        failures.push(
          `${side.name} rounds must all carry a "<stem>-<round>" label in paired mode ` +
            `(got ${labels.map((l) => JSON.stringify(l)).join(", ")}) — ` +
            `the labels tie each round file to its measurement order.`,
        );
      } else {
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
      }
    }
  }

  // --- Suite fingerprint: the equality gate for the workload itself --------------------
  // The base and head checkouts each run their OWN tests/perf code, so identical scenario
  // metadata can still hide a workload edit (e.g. a fixture payload). The suite
  // fingerprint hashes the suite's source files; any difference fails closed.
  const sidePrints = sides.map((side) => side.runs.map((r) => r.meta.suiteFingerprint));
  for (const [si, side] of sides.entries()) {
    const defined = sidePrints[si].filter((f) => f !== undefined);
    if (defined.length > 0 && defined.length < side.runs.length) {
      failures.push(
        `${side.name} rounds disagree on carrying a suite fingerprint — ` +
          `the round files come from different suite versions; re-record them with one harness.`,
      );
    }
  }
  const baseHasPrints = sidePrints[0].every((f) => f !== undefined);
  const headHasPrints = sidePrints[1].every((f) => f !== undefined);
  if (!headHasPrints && baseHasPrints) {
    // A current side without fingerprints means they were REMOVED — never the rollout
    // case, and the grace flag must not excuse it.
    failures.push(
      `the current reports carry no suite fingerprint — removing fingerprints is not the rollout case ` +
        `and is never excused; re-record the current reports with the current harness.`,
    );
  } else if (!baseHasPrints && headHasPrints && !options.allowUnfingerprintedBase) {
    failures.push(
      `the base reports carry no suite fingerprint — they predate workload fingerprinting. ` +
        `Re-record them (or merge a base that contains fingerprints), ` +
        `or pass --allow-unfingerprinted-base during the transition.`,
    );
  }
  if (baseHasPrints && headHasPrints && new Set([...sidePrints[0], ...sidePrints[1]]).size > 1) {
    failures.push(
      `the perf suite itself differs between the two revisions ` +
        `(suite fingerprint ${sidePrints[0][0]} vs ${sidePrints[1][0]}) — a change to tests/perf ` +
        `(scenarios, fixtures, helpers, harness) changes the workload the gate compares, so the gate ` +
        `fails closed on purpose: suite edits are flagged for explicit review, not waved through. ` +
        `Land an intentional suite change with the gate red, or as its own PR.`,
    );
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
  const baseNames = new Set(orders[0]);

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

    // --- Identity and workload: the same name must be the same measurement everywhere ---
    const drift = identityDrift(
      name,
      pairs.flatMap((pair, i) => [
        { side: "base", round: i + 1, scenario: pair.base },
        { side: "current", round: i + 1, scenario: pair.head },
      ]),
      options.allowUnfingerprintedBase,
    );
    if (drift.length > 0) {
      failures.push(...drift);
      continue;
    }

    const logRatios = pairs.map((p) => Math.log(p.head.nsPerUnit / p.base.nsPerUnit));
    const m = median(logRatios);
    const w = Math.max(...logRatios.map((r) => Math.abs(r - m)));
    const deltaPct = (Math.exp(m) - 1) * 100;
    const lowerPct = (Math.exp(m - w) - 1) * 100;
    const upperPct = (Math.exp(m + w) - 1) * 100;
    const tolerancePct = thresholdPct + median(pairs.map((p) => p.base.rme)) + median(pairs.map((p) => p.head.rme));

    // Verdict by MAJORITY of rounds (see the module doc): with n = 3, two rounds must
    // clear a verdict line on their own; with n = 1 the single round decides. The median
    // ± max-deviation band above is retained for display, not for the verdict.
    const regressionLine = Math.log(1 + tolerancePct / 100);
    const improvementLine = Math.log(1 - thresholdPct / 100);
    const majority = Math.floor(pairs.length / 2) + 1;
    const regressRounds = logRatios.filter((r) => r > regressionLine).length;
    const improveRounds = logRatios.filter((r) => r < improvementLine).length;
    const majorityVerdict =
      regressRounds >= majority ? "regression" : improveRounds >= majority ? "improvement" : undefined;

    // Fail closed on an inconclusive measurement: an extreme spread (the band spans more
    // than a 2x factor around the median) that MASKS a majority agreement means one
    // contaminated round is hiding the signal — the gate cannot be trusted either way.
    if (w > INCONCLUSIVE_HALF_WIDTH && majorityVerdict !== undefined) {
      failures.push(
        `scenario ${JSON.stringify(name)} is inconclusive: ` +
          `${majorityVerdict === "regression" ? regressRounds : improveRounds} of ${pairs.length} rounds agree on ` +
          `${majorityVerdict}, but the spread is extreme (band [${signedPct(lowerPct)}, ${signedPct(upperPct)}]) — ` +
          `the measurement is too noisy to trust; rerun the gate instead of waving it through.`,
      );
      continue;
    }

    // Representative pair for the table: the actual round whose log-ratio is the median
    // (always one of the rounds — paired mode requires an odd count), so the displayed
    // baseline/current always reproduce deltaPct and the band.
    let best = 0;
    for (let i = 1; i < pairs.length; i++) {
      if (Math.abs(logRatios[i] - m) < Math.abs(logRatios[best] - m)) best = i;
    }

    comparisons.push({
      name,
      group: pairs[0].base.group,
      baseline: pairs[best].base,
      current: pairs[best].head,
      deltaPct,
      speedup: Math.exp(-m),
      lowerPct,
      upperPct,
      tolerancePct,
      rounds: pairs.length,
      representativeRound: best + 1,
      verdict: majorityVerdict ?? "unchanged",
    });
  }

  // --- Head-only scenarios: informational "added", but validated like any scenario ------
  const added: string[] = [];
  for (const name of orders[1]) {
    if (baseNames.has(name) || partial.has(`1:${name}`)) continue;
    added.push(name);
    failures.push(
      ...identityDrift(
        name,
        mapsByRound[1].map((roundMap, i) => ({
          side: "current",
          round: i + 1,
          scenario: roundMap.get(name) as ScenarioResult,
        })),
        options.allowUnfingerprintedBase,
      ),
    );
  }

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
export function compareReports(
  baseline: PerfReport,
  current: PerfReport,
  thresholdPct: number,
  options: CompareOptions = {},
): ComparisonResult {
  return comparePairedReports([baseline], [current], thresholdPct, options);
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
      comparisons[0].rounds > 1
        ? `values    baseline/current show the median round's measured pair for each scenario`
        : `values    baseline/current show the single measured round per side (the band is a point)`,
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
    formatNs(c.baseline.nsPerUnit),
    formatNs(c.current.nsPerUnit),
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
the same length (an odd number) and be in the order the rounds were measured.
Flags: --allow-environment-mismatch, --allow-unfingerprinted-base (transition grace for
bases recorded before workload fingerprinting).`;

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

  // Usage errors (unequal or even round counts) are exit-2 errors, not stack traces.
  let result: ComparisonResult;
  try {
    result = comparePairedReports(baselineRuns, currentRuns, thresholdPct, {
      allowUnfingerprintedBase: args.includes("--allow-unfingerprinted-base"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }

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
