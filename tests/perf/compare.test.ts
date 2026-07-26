/**
 * Unit tests for the paired-round comparison in `.dev/perf/compare.ts`.
 *
 * The estimator pairs round i of the base revision with round i of the head revision and
 * aggregates the per-round log-ratios with a median plus a max-deviation band (see the
 * module doc of `compare.ts` for the math). These tests pin the verdicts that motivated
 * the design:
 *
 * - the reviewer's real CI numbers, where per-side minima claimed an 11.5% speedup while
 *   every paired ratio sat within noise of 1.0 — must be "unchanged";
 * - a consistent slowdown visible in every round — must be "regression";
 * - one contaminated round (a 10x outlier in a single head run) — must stay "unchanged"
 *   because the contamination inflates the band instead of shifting the median;
 * - the strict input validation: unequal or even round counts, partial rounds, identity
 *   drift (including sampling parameters), workload and suite fingerprint mismatch,
 *   fingerprint presence parity, missing labels, and mixed suite files must FAIL the
 *   comparison rather than silently degrade it.
 *
 * @module
 */

import { test } from "bun:test";
import { assert, assertEquals, assertThrows } from "@jsr/std__assert";
import { comparePairedReports, compareReports, isFailure, renderComparison } from "../../.dev/perf/compare.ts";
import { formatNs, type PerfReport } from "./_harness.ts";

/** One scenario in a fixture report; identity fields default to stable values. */
interface ScenarioSpec {
  name: string;
  nsPerUnit: number;
  rme?: number;
  unit?: string;
  group?: string;
  description?: string;
  samples?: number;
  iterations?: number;
  unitsPerIteration?: number;
  fingerprint?: string;
}

/** Builds a one-report-per-round fixture with the given scenarios. */
function report(label: string, scenarios: ScenarioSpec[], suiteFingerprint?: string): PerfReport {
  return {
    schema: 1,
    meta: {
      commit: "0000000000000000000000000000000000000000",
      dirty: false,
      runtime: "test-runtime",
      cpu: "test-cpu",
      os: "test-os",
      date: "2026-01-01T00:00:00.000Z",
      ...(suiteFingerprint !== undefined ? { suiteFingerprint } : {}),
      label,
    },
    scenarios: scenarios.map((s) => ({
      name: s.name,
      group: s.group ?? "test",
      description: s.description ?? `${s.name} description`,
      unit: s.unit ?? "op",
      samples: s.samples ?? 15,
      iterations: s.iterations ?? 1,
      unitsPerIteration: s.unitsPerIteration ?? 1,
      nsPerUnit: s.nsPerUnit,
      unitsPerSec: 1e9 / s.nsPerUnit,
      min: s.nsPerUnit,
      p50: s.nsPerUnit,
      p75: s.nsPerUnit,
      p99: s.nsPerUnit,
      max: s.nsPerUnit,
      stddev: 0,
      rme: s.rme ?? 0.5,
      ...(s.fingerprint !== undefined ? { fingerprint: s.fingerprint } : {}),
    })),
  };
}

/** Builds `costs.length` labelled rounds of a single-scenario report. */
function roundsOf(side: string, name: string, costs: number[], rme = 0.5): PerfReport[] {
  return costs.map((nsPerUnit, i) => report(`${side}-${i + 1}`, [{ name, nsPerUnit, rme }]));
}

test("equal medians with divergent minima -> unchanged (the reviewer's CI numbers)", () => {
  // Real CI data for order_sequential, in µs (used as ns — the estimator is scale-invariant).
  // The old min-of-3 merge compared 239.41 against 270.46 and claimed head was 11.5% FASTER;
  // the paired view: ratios 0.993 / 1.004 / 0.885, median ~1.0 (round 1's ratio).
  const base = roundsOf("base", "order_sequential", [273.86, 273.38, 270.46]);
  const head = roundsOf("head", "order_sequential", [271.85, 274.47, 239.41]);

  const result = comparePairedReports(base, head, 10);

  assertEquals(result.failures, []);
  assertEquals(result.missing, []);
  assertEquals(result.added, []);
  assertEquals(result.comparisons.length, 1);
  const c = result.comparisons[0];
  assertEquals(c.verdict, "unchanged");
  assertEquals(c.rounds, 3);
  // The median paired change is ~-0.7%, NOT the -11.5% the minima implied.
  assert(Math.abs(c.deltaPct) < 2, `median paired change ${c.deltaPct}% should be near 0`);
  // The band covers the noisy third round on both sides.
  assert(c.lowerPct < -10 && c.upperPct > 10, `band [${c.lowerPct}%, ${c.upperPct}%] should straddle the threshold`);

  // The representative pair is the median round's ACTUAL measured pair (round 1), so the
  // displayed values reproduce deltaPct instead of contradicting it.
  assertEquals(c.representativeRound, 1);
  assertEquals(c.baseline.nsPerUnit, 273.86);
  assertEquals(c.current.nsPerUnit, 271.85);
  const rendered = renderComparison(base, head, result, 10);
  assert(rendered.includes("median round's measured pair"), `legend missing:\n${rendered}`);
  assert(rendered.includes(formatNs(273.86)) && rendered.includes(formatNs(271.85)), `pair missing:\n${rendered}`);
});

test("consistent real regression across all rounds -> regression", () => {
  const base = roundsOf("base", "scenario", [100, 100, 100], 1);
  const head = roundsOf("head", "scenario", [120, 122, 118], 1);

  const result = comparePairedReports(base, head, 10);

  assertEquals(result.failures, []);
  assertEquals(result.comparisons.length, 1);
  const c = result.comparisons[0];
  assertEquals(c.verdict, "regression");
  assert(isFailure(result));
  // Median +20%, band roughly [+18%, +22%] — entirely above the 10% + 2% noise floor.
  assert(Math.abs(c.deltaPct - 20) < 1, `deltaPct ${c.deltaPct}`);
  assert(c.lowerPct > 12, `lower bound ${c.lowerPct}% should clear the noise floor`);
  // The median ratio is round 1's (120/100), so that is the pair the table shows.
  assertEquals(c.representativeRound, 1);
  assertEquals(c.baseline.nsPerUnit, 100);
  assertEquals(c.current.nsPerUnit, 120);
});

test("one contaminated round (10x outlier in a single head run) -> unchanged", () => {
  const base = roundsOf("base", "scenario", [100, 100, 100], 1);
  const head = roundsOf("head", "scenario", [100, 100, 1000], 1);

  const { comparisons } = comparePairedReports(base, head, 10);

  assertEquals(comparisons.length, 1);
  const c = comparisons[0];
  // The median is one of the two good rounds; the outlier only widens the band.
  assertEquals(c.verdict, "unchanged");
  assert(Math.abs(c.deltaPct) < 1, `median paired change ${c.deltaPct}% should be ~0`);
});

test("consistent improvement across all rounds -> improvement", () => {
  const base = roundsOf("base", "scenario", [100, 100, 100], 1);
  const head = roundsOf("head", "scenario", [80, 82, 78], 1);

  const { comparisons } = comparePairedReports(base, head, 10);

  assertEquals(comparisons.length, 1);
  assertEquals(comparisons[0].verdict, "improvement");
  assert(comparisons[0].upperPct < -10, `upper bound ${comparisons[0].upperPct}% should be below -threshold`);
});

test("missing and added scenarios", () => {
  const base = [1, 2, 3].map((i) =>
    report(`base-${i}`, [
      { name: "kept", nsPerUnit: 100 },
      { name: "gone", nsPerUnit: 50 },
    ]),
  );
  const head = [1, 2, 3].map((i) =>
    report(`head-${i}`, [
      { name: "kept", nsPerUnit: 100 },
      { name: "fresh", nsPerUnit: 25 },
    ]),
  );

  const result = comparePairedReports(base, head, 10);

  assertEquals(result.failures, []);
  assertEquals(result.missing, ["gone"]);
  assertEquals(result.added, ["fresh"]);
  assertEquals(
    result.comparisons.map((c) => c.name),
    ["kept"],
  );
  assertEquals(result.comparisons[0].verdict, "unchanged");
  // A vanished baseline scenario fails the gate even without a regression.
  assert(isFailure(result));
});

test("single-pair compareReports keeps the one-round gate semantics and shows the measured pair", () => {
  const baseline = report("baseline", [{ name: "scenario", nsPerUnit: 100, rme: 2 }]);
  const regressed = report("current", [{ name: "scenario", nsPerUnit: 125, rme: 2 }]);
  const same = report("current", [{ name: "scenario", nsPerUnit: 105, rme: 2 }]);

  // One round per side: the band is a point and the verdict compares the delta against
  // threshold (10) + both runs' margins of error (2 + 2).
  const regression = compareReports(baseline, regressed, 10);
  assertEquals(regression.comparisons[0].verdict, "regression");
  assertEquals(regression.comparisons[0].rounds, 1);
  assert(isFailure(regression));

  const unchanged = compareReports(baseline, same, 10);
  assertEquals(unchanged.comparisons[0].verdict, "unchanged");
  assert(!isFailure(unchanged));

  // A single pair IS a real representative pair: the table shows its measured values.
  assertEquals(unchanged.comparisons[0].representativeRound, 1);
  const rendered = renderComparison(baseline, same, unchanged, 10);
  assert(rendered.includes("single measured round per side"), `legend missing:\n${rendered}`);
  assert(rendered.includes(formatNs(100)) && rendered.includes(formatNs(105)), `values missing:\n${rendered}`);
  assert(!rendered.includes("—"), `single-pair table must not fall back to em dashes:\n${rendered}`);
});

test("unequal round counts are a usage error, not a silent truncation", () => {
  const base = roundsOf("base", "scenario", [100, 100, 100]);
  const head = roundsOf("head", "scenario", [100, 100]);

  assertThrows(
    () => comparePairedReports(base, head, 10),
    Error,
    "same number of rounds on both sides (got 3 base vs 2 current)",
  );
});

test("even round counts are rejected in paired mode; one round is fine", () => {
  // With an even count the median log-ratio falls between two rounds and no measured pair
  // could represent it.
  assertThrows(
    () => comparePairedReports(roundsOf("base", "scenario", [100, 100]), roundsOf("head", "scenario", [100, 100]), 10),
    Error,
    "odd round count in paired mode (got 2)",
  );
  assertThrows(
    () =>
      comparePairedReports(
        roundsOf("base", "scenario", [100, 100, 100, 100]),
        roundsOf("head", "scenario", [100, 100, 100, 100]),
        10,
      ),
    Error,
    "odd round count in paired mode (got 4)",
  );

  // n=1 is the gate.ts form and works.
  const single = compareReports(
    report("baseline", [{ name: "scenario", nsPerUnit: 100 }]),
    report("current", [{ name: "scenario", nsPerUnit: 100 }]),
    10,
  );
  assertEquals(single.failures, []);
  assertEquals(single.comparisons[0].rounds, 1);
});

test("a round that omits a scenario fails the comparison and names it", () => {
  const base = [1, 2, 3].map((i) =>
    report(`base-${i}`, [
      { name: "a", nsPerUnit: 100 },
      { name: "b", nsPerUnit: 50 },
    ]),
  );
  const head = [
    report("head-1", [
      { name: "a", nsPerUnit: 100 },
      { name: "b", nsPerUnit: 50 },
    ]),
    report("head-2", [{ name: "a", nsPerUnit: 100 }]), // "b" dropped in this round
    report("head-3", [
      { name: "a", nsPerUnit: 100 },
      { name: "b", nsPerUnit: 50 },
    ]),
  ];

  const result = comparePairedReports(base, head, 10);

  assert(isFailure(result));
  assertEquals(result.failures.length, 1);
  assert(result.failures[0].includes('"b"'), `scenario not named: ${result.failures[0]}`);
  assert(result.failures[0].includes("current round(s) 2"), `round/side not named: ${result.failures[0]}`);
  // The reduced-n silent path is gone: "b" gets no shrunken comparison and no silent
  // "missing" entry — only the loud validation failure. "a" still gets all 3 rounds.
  assertEquals(
    result.comparisons.map((c) => c.name),
    ["a"],
  );
  assertEquals(result.comparisons[0].rounds, 3);
  assertEquals(result.missing, []);
});

test("identity drift between rounds or sides fails the comparison", () => {
  const drift = (
    field: "unit" | "group" | "description" | "samples" | "iterations" | "unitsPerIteration",
    value: string | number,
    side: "base" | "head",
    round: number,
  ): string[] => {
    const stable = {
      base: roundsOf("base", "scenario", [100, 100, 100]),
      head: roundsOf("head", "scenario", [100, 100, 100]),
    };
    stable[side][round - 1] = report(`${side}-${round}`, [{ name: "scenario", nsPerUnit: 100, [field]: value }]);
    return comparePairedReports(stable.base, stable.head, 10).failures;
  };

  const unit = drift("unit", "order", "head", 2);
  assertEquals(unit.length, 1);
  assert(unit[0].includes("unit") && unit[0].includes("current round 2"), `unit drift: ${unit[0]}`);

  const group = drift("group", "other", "base", 3);
  assertEquals(group.length, 1);
  assert(group[0].includes("group") && group[0].includes("base round 3"), `group drift: ${group[0]}`);

  const description = drift("description", "renamed thing", "head", 1);
  assertEquals(description.length, 1);
  assert(description[0].includes("description"), `description drift: ${description[0]}`);

  // A changed sampling parameter is a changed measurement, and must fail the same way.
  const samples = drift("samples", 30, "head", 2);
  assertEquals(samples.length, 1);
  assert(samples[0].includes("samples"), `samples drift: ${samples[0]}`);

  const iterations = drift("iterations", 200, "base", 1);
  assertEquals(iterations.length, 1);
  assert(iterations[0].includes("iterations"), `iterations drift: ${iterations[0]}`);

  const unitsPerIteration = drift("unitsPerIteration", 100, "head", 3);
  assertEquals(unitsPerIteration.length, 1);
  assert(unitsPerIteration[0].includes("unitsPerIteration"), `unitsPerIteration drift: ${unitsPerIteration[0]}`);
});

test("head-only (added) scenarios get the same cross-round identity validation", () => {
  const base = roundsOf("base", "kept", [100, 100, 100]);
  const head = [
    report("head-1", [
      { name: "kept", nsPerUnit: 100 },
      { name: "fresh", nsPerUnit: 25 },
    ]),
    report("head-2", [
      { name: "kept", nsPerUnit: 100 },
      { name: "fresh", nsPerUnit: 25, unit: "order" }, // drifted identity in one round
    ]),
    report("head-3", [
      { name: "kept", nsPerUnit: 100 },
      { name: "fresh", nsPerUnit: 25 },
    ]),
  ];

  const result = comparePairedReports(base, head, 10);

  assert(isFailure(result));
  assertEquals(result.added, ["fresh"]); // still informational…
  assertEquals(result.failures.length, 1); // …but the drift fails loudly
  assert(result.failures[0].includes('"fresh"') && result.failures[0].includes("unit"), `drift: ${result.failures[0]}`);
});

test("workload fingerprint: mismatch fails, presence parity fails, grace excuses only parity", () => {
  const withPrint = (side: string, fingerprint: string | undefined): PerfReport[] =>
    [1, 2, 3].map((i) => report(`${side}-${i}`, [{ name: "scenario", nsPerUnit: 100, fingerprint }]));

  const mismatch = comparePairedReports(
    withPrint("base", "aaaaaaaaaaaaaaaa"),
    withPrint("head", "bbbbbbbbbbbbbbbb"),
    10,
  );
  assert(isFailure(mismatch));
  assertEquals(mismatch.failures.length, 1);
  assert(mismatch.failures[0].includes("fingerprint differs"), `fingerprint: ${mismatch.failures[0]}`);

  const same = comparePairedReports(withPrint("base", "aaaaaaaaaaaaaaaa"), withPrint("head", "aaaaaaaaaaaaaaaa"), 10);
  assertEquals(same.failures, []);

  // Presence parity: an unfingerprinted base against a fingerprinted head fails closed by
  // default with a migration message…
  const legacy = comparePairedReports(withPrint("base", undefined), withPrint("head", "bbbbbbbbbbbbbbbb"), 10);
  assert(isFailure(legacy));
  assertEquals(legacy.failures.length, 1);
  assert(legacy.failures[0].includes("predate workload fingerprinting"), `parity: ${legacy.failures[0]}`);

  // …and only the explicit transition grace excuses it. The grace never excuses a mismatch:
  const grace = comparePairedReports(withPrint("base", undefined), withPrint("head", "bbbbbbbbbbbbbbbb"), 10, {
    allowUnfingerprintedBase: true,
  });
  assertEquals(grace.failures, []);
  const graceMismatch = comparePairedReports(
    withPrint("base", "aaaaaaaaaaaaaaaa"),
    withPrint("head", "bbbbbbbbbbbbbbbb"),
    10,
    {
      allowUnfingerprintedBase: true,
    },
  );
  assert(isFailure(graceMismatch));
});

test("suite fingerprint: mismatch fails closed, presence parity fails, grace excuses only parity", () => {
  const withSuite = (side: string, suiteFingerprint: string | undefined): PerfReport[] =>
    [1, 2, 3].map((i) => report(`${side}-${i}`, [{ name: "scenario", nsPerUnit: 100 }], suiteFingerprint));

  // Any suite-source edit between the revisions fails closed — that is the equality gate.
  const mismatch = comparePairedReports(
    withSuite("base", "suiteaaaaaaaaaaa"),
    withSuite("head", "suitebbbbbbbbbbbb"),
    10,
  );
  assert(isFailure(mismatch));
  assertEquals(mismatch.failures.length, 1);
  assert(mismatch.failures[0].includes("perf suite itself differs"), `suite: ${mismatch.failures[0]}`);

  const same = comparePairedReports(withSuite("base", "suiteaaaaaaaaaaa"), withSuite("head", "suiteaaaaaaaaaaa"), 10);
  assertEquals(same.failures, []);

  // Presence parity: pre-fingerprint base vs fingerprinted head fails with a migration
  // message by default and passes only with the transition grace.
  const legacy = comparePairedReports(withSuite("base", undefined), withSuite("head", "suitebbbbbbbbbbbb"), 10);
  assert(isFailure(legacy));
  assert(
    legacy.failures.some((f) => f.includes("predate workload fingerprinting")),
    `parity: ${legacy.failures}`,
  );
  const grace = comparePairedReports(withSuite("base", undefined), withSuite("head", "suitebbbbbbbbbbbb"), 10, {
    allowUnfingerprintedBase: true,
  });
  assertEquals(grace.failures, []);

  // Fingerprints in only SOME rounds of one side means files from different suite
  // versions — the grace does not excuse that.
  const mixedSide = withSuite("base", "suiteaaaaaaaaaaa");
  delete mixedSide[1].meta.suiteFingerprint;
  const mixed = comparePairedReports(mixedSide, withSuite("head", "suiteaaaaaaaaaaa"), 10, {
    allowUnfingerprintedBase: true,
  });
  assert(isFailure(mixed));
  assert(
    mixed.failures.some((f) => f.includes("different suite versions")),
    `mixed: ${mixed.failures}`,
  );
});

test("round labels are required in paired mode", () => {
  const unlabelled = (side: string): PerfReport[] =>
    [1, 2, 3].map((i) => {
      const r = report(`${side}-${i}`, [{ name: "scenario", nsPerUnit: 100 }]);
      delete r.meta.label;
      return r;
    });

  const result = comparePairedReports(unlabelled("base"), unlabelled("head"), 10);

  assert(isFailure(result));
  assertEquals(result.failures.length, 2); // one per side
  assert(result.failures[0].includes('must all carry a "<stem>-<round>" label'), `labels: ${result.failures[0]}`);
});

test("round labels from different suites or out of order fail the comparison", () => {
  const mixedStems = comparePairedReports(
    [
      report("base-1", [{ name: "scenario", nsPerUnit: 100 }]),
      report("base-2", [{ name: "scenario", nsPerUnit: 100 }]),
      report("old-3", [{ name: "scenario", nsPerUnit: 100 }]), // a different suite's file
    ],
    roundsOf("head", "scenario", [100, 100, 100]),
    10,
  );
  assert(isFailure(mixedStems));
  assertEquals(mixedStems.failures.length, 1);
  assert(mixedStems.failures[0].includes("mix label stems"), `stems: ${mixedStems.failures[0]}`);

  const misordered = comparePairedReports(
    [
      report("base-2", [{ name: "scenario", nsPerUnit: 100 }]), // round files out of order
      report("base-1", [{ name: "scenario", nsPerUnit: 100 }]),
      report("base-3", [{ name: "scenario", nsPerUnit: 100 }]),
    ],
    roundsOf("head", "scenario", [100, 100, 100]),
    10,
  );
  assert(isFailure(misordered));
  assertEquals(misordered.failures.length, 1);
  assert(misordered.failures[0].includes("measurement order"), `order: ${misordered.failures[0]}`);
});
