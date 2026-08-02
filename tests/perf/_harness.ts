/**
 * Measurement core for the performance suite.
 *
 * Scenarios are registered with {@linkcode scenario} and executed by `tests/perf/run.ts`,
 * which writes a machine-readable {@linkcode PerfReport} used by two consumers:
 * - `.dev/perf/gate.ts` — the zero-regression gate, via `.dev/perf/compare.ts` (baseline vs. current)
 * - the speedup chart, which reads the same JSON
 *
 * ## Methodology
 *
 * Each scenario runs `warmupSamples` discarded samples (letting V8 tier up and settle
 * allocation behaviour), then `samples` measured ones. A sample times `iterations`
 * calls of the body and divides, so per-call cost stays resolvable even when a single
 * call is faster than the clock.
 *
 * The headline statistic is the **median** (`p50`) per-op time, not the mean: benchmark
 * noise on a developer machine is one-sided (scheduler preemption, GC, thermal), so the
 * mean drifts upward with outliers while the median stays put. `rme` — the Student-t 95%
 * margin of the sample MEAN — is reported as a sampling-noise magnitude. Note it describes
 * the mean while `nsPerUnit` is the median: the comparator uses it as a noise scale inside
 * a deliberately conservative heuristic, not as a confidence interval.
 * @module
 */

import { createHash } from "node:crypto";

/** Extra scenario-specific numbers recorded alongside timing (e.g. `maxInFlight`). */
export type ExtraMetrics = Record<string, number>;

/** A registered performance scenario. */
export interface Scenario {
  /** Stable identifier — the key the regression gate joins baseline and current on. Never rename casually. */
  name: string;
  /** Grouping for the report and chart, e.g. `"signing"`, `"data"`, `"transport"`, `"subscription"`. */
  group: string;
  /** One-line description of what is being measured and why it matters. */
  description: string;
  /** Runs once before warmup; its return value is passed to {@linkcode Scenario.run}. */
  setup?: () => Promise<unknown> | unknown;
  /** Runs once after the final sample, for teardown (restoring globals, closing transports). */
  teardown?: (ctx: never) => Promise<void> | void;
  /**
   * The measured body. May return {@linkcode ExtraMetrics}; values from the last
   * measured sample are kept in the report.
   */
  run: (ctx: never) => Promise<void | ExtraMetrics> | void | ExtraMetrics;
  /** Calls of {@linkcode Scenario.run} per timed sample. Default `1`. */
  iterations?: number;
  /** Measured samples. Default `15`. */
  samples?: number;
  /** Discarded samples before measuring. Default `3`. */
  warmupSamples?: number;
  /**
   * Units of work per {@linkcode Scenario.run} call, for normalizing batch scenarios.
   * A 100-order batch sets `100`, so `nsPerUnit` is comparable to the single-order scenario.
   * Default `1`.
   */
  unitsPerIteration?: number;
  /** Unit label for the report, e.g. `"order"`, `"frame"`, `"parse"`. Default `"op"`. */
  unit?: string;
}

/** Timing and derived statistics for one scenario. */
export interface ScenarioResult {
  name: string;
  group: string;
  description: string;
  unit: string;
  samples: number;
  iterations: number;
  unitsPerIteration: number;
  /** Median per-unit cost in nanoseconds — the statistic the regression gate compares. */
  nsPerUnit: number;
  /** Units processed per second, derived from {@linkcode ScenarioResult.nsPerUnit}. */
  unitsPerSec: number;
  /** Per-unit percentiles in nanoseconds, across samples. */
  min: number;
  p50: number;
  p75: number;
  p99: number;
  max: number;
  /** Sample standard deviation of per-unit cost, in nanoseconds. */
  stddev: number;
  /** Relative margin of error of the mean at 95% confidence, as a percentage of the mean. */
  rme: number;
  /**
   * Fingerprint of the scenario definition and workload code (see {@linkcode scenarioFingerprint}).
   * Optional so schema-1 reports recorded before fingerprints existed still load.
   */
  fingerprint?: string;
  /** Scenario-specific metrics from the final measured sample. */
  extra?: ExtraMetrics;
}

/**
 * Deterministic fingerprint of a scenario's definition and workload code.
 *
 * Hashes everything the registry knows about the measurement that is NOT a measured value:
 * identity fields, sampling parameters (with defaults applied), and the source text of
 * `run`/`setup`/`teardown`. Editing a scenario's code or inline workload parameters (e.g.
 * a fixture-size argument at the call site) changes the fingerprint, so the regression
 * gate can refuse to compare unequal workloads.
 *
 * Blind spot, by design: edits inside imported helper/fixture modules that keep the call
 * sites unchanged (e.g. `_fixtures.ts` producing a different payload at the same size) do
 * not change the fingerprint — the hash covers the scenario registry, not the module graph.
 */
export function scenarioFingerprint(def: Scenario): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      name: def.name,
      group: def.group,
      description: def.description,
      iterations: def.iterations ?? 1,
      samples: def.samples ?? 15,
      warmupSamples: def.warmupSamples ?? 3,
      unitsPerIteration: def.unitsPerIteration ?? 1,
      unit: def.unit ?? "op",
    }),
  );
  hash.update(def.run.toString());
  hash.update(def.setup?.toString() ?? "");
  hash.update(def.teardown?.toString() ?? "");
  return hash.digest("hex").slice(0, 16);
}

/** A complete run: environment metadata plus every scenario result. */
export interface PerfReport {
  /**
   * Report format version. Bump when the shape changes so old baselines fail loudly.
   * Additive OPTIONAL fields (e.g. `ScenarioResult.fingerprint`) do not bump the version:
   * old reports load as-is, and the comparator treats the absent field as "unknown".
   */
  schema: 1;
  meta: {
    /** Git commit the measurements describe. */
    commit: string;
    /** `true` when the working tree had uncommitted changes (so the commit alone does not identify the code). */
    dirty: boolean;
    runtime: string;
    cpu: string;
    os: string;
    /** ISO-8601 timestamp. */
    date: string;
    /**
     * Fingerprint of the perf suite's source files (scenarios, fixtures, helpers,
     * harness) — the workload-equality gate. Optional so schema-1 reports recorded before
     * fingerprints existed still load; the comparator treats absence explicitly.
     */
    suiteFingerprint?: string;
    /** Optional free-text label, e.g. `"baseline"` or `"post-fix"`. */
    label?: string;
  };
  scenarios: ScenarioResult[];
}

const registry: Scenario[] = [];

/**
 * Registers a performance scenario.
 *
 * Importing a scenario module is what registers it; `tests/perf/run.ts` imports them all.
 *
 * @param def The scenario definition.
 * @throws {Error} If {@linkcode Scenario.name} is already registered.
 */
export function scenario(def: Scenario): void {
  if (registry.some((s) => s.name === def.name)) {
    throw new Error(`Duplicate perf scenario name: ${JSON.stringify(def.name)}`);
  }
  registry.push(def);
}

/** All registered scenarios, in registration order. */
export function registeredScenarios(): readonly Scenario[] {
  return registry;
}

/** Student's t critical values at 95% confidence, indexed by degrees of freedom (1-30). */
const T_TABLE_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** Two-tailed t critical value at 95% confidence for `df` degrees of freedom. */
function tCritical95(df: number): number {
  if (df < 1) return T_TABLE_95[0];
  if (df <= 30) return T_TABLE_95[df - 1];
  return 1.96; // normal approximation is close enough beyond df=30
}

/** Percentile of a pre-sorted array using nearest-rank. */
function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** Executes one scenario and returns its statistics. */
export async function runScenario(def: Scenario): Promise<ScenarioResult> {
  const iterations = def.iterations ?? 1;
  const samples = def.samples ?? 15;
  const warmupSamples = def.warmupSamples ?? 3;
  const unitsPerIteration = def.unitsPerIteration ?? 1;
  const unit = def.unit ?? "op";

  const ctx = (await def.setup?.()) as never;

  // One sample: `iterations` calls, timed as a block, reduced to per-unit nanoseconds.
  //
  // Iterations are STRICTLY SEQUENTIAL — each `run` is awaited before the next begins — so a
  // scenario's peak concurrency is whatever a single `run` body creates, and is 1 for any
  // scenario whose body performs one request. That is a deliberate property (it isolates
  // per-operation CPU from queueing effects), but it has a sharp consequence worth knowing
  // before reading any result: **these scenarios cannot surface a cost that scales with the
  // number of in-flight operations.**
  //
  // A real instance: the WebSocket dispatcher registered one abort listener per in-flight
  // request on a single `AbortSignal` shared by the whole socket, which is O(n^2) across a
  // burst. `transport/ws_request_round_trip` never saw it — at an in-flight count of 1 the
  // defect is a ~300 ns constant — and it went unnoticed until a burst was measured outside
  // the suite. A scenario that needs to catch that class of defect has to build the
  // concurrency inside its own `run` body, the way `transaction/order_100_concurrent` does.
  const sample = async (): Promise<{ nsPerUnit: number; extra?: ExtraMetrics }> => {
    let extra: ExtraMetrics | undefined;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const out = await def.run(ctx);
      if (out) extra = out;
    }
    const elapsedMs = performance.now() - start;
    return { nsPerUnit: (elapsedMs * 1e6) / (iterations * unitsPerIteration), extra };
  };

  for (let i = 0; i < warmupSamples; i++) await sample();

  const perUnit: number[] = [];
  let lastExtra: ExtraMetrics | undefined;
  for (let i = 0; i < samples; i++) {
    const { nsPerUnit, extra } = await sample();
    perUnit.push(nsPerUnit);
    if (extra) lastExtra = extra;
  }

  await def.teardown?.(ctx);

  const sorted = [...perUnit].sort((a, b) => a - b);
  const mean = perUnit.reduce((a, b) => a + b, 0) / perUnit.length;
  // Sample variance (Bessel-corrected); a single sample has no spread to report.
  const variance = perUnit.length > 1 ? perUnit.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (perUnit.length - 1) : 0;
  const stddev = Math.sqrt(variance);
  const stderr = stddev / Math.sqrt(perUnit.length);
  const rme = mean > 0 ? ((tCritical95(perUnit.length - 1) * stderr) / mean) * 100 : 0;
  const p50 = percentile(sorted, 0.5);

  return {
    name: def.name,
    group: def.group,
    description: def.description,
    unit,
    samples,
    iterations,
    unitsPerIteration,
    nsPerUnit: p50,
    unitsPerSec: p50 > 0 ? 1e9 / p50 : 0,
    min: sorted[0],
    p50,
    p75: percentile(sorted, 0.75),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    stddev,
    rme,
    fingerprint: scenarioFingerprint(def),
    ...(lastExtra ? { extra: lastExtra } : {}),
  };
}

/** Formats nanoseconds into a compact human-readable duration. */
export function formatNs(ns: number): string {
  if (!Number.isFinite(ns)) return "n/a";
  if (ns < 1_000) return `${ns.toFixed(1)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}
