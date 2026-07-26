/**
 * Performance suite entry point: runs every registered scenario and writes a
 * {@linkcode PerfReport} JSON file plus a human-readable table.
 *
 * @example Measure the current tree
 * ```sh
 * bun run tests/perf/run.ts --out tests/perf/results/current.json
 * ```
 *
 * @example Record a labelled baseline
 * ```sh
 * bun run tests/perf/run.ts --label baseline --out tests/perf/results/baseline.json
 * ```
 *
 * @example Run a subset while iterating on one hot path
 * ```sh
 * bun run tests/perf/run.ts --filter signing
 * ```
 * @module
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { formatNs, type PerfReport, registeredScenarios, runScenario, type ScenarioResult } from "./_harness.ts";

// --- Scenario registration -------------------------------------------------
// Importing a module registers its scenarios. Keep this list alphabetical.
import "./scenarios/data_parse.ts";
import "./scenarios/signing.ts";
import "./scenarios/subscription.ts";
import "./scenarios/symbol_converter.ts";
import "./scenarios/transaction.ts";
import "./scenarios/transport.ts";

/** Reads a `--flag value` pair from the argument list. */
function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** Runs a git command, returning its trimmed stdout, or `""` if git is unavailable. */
async function git(...args: string[]): Promise<string> {
  try {
    const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(child.stdout).text();
    return (await child.exited) === 0 ? stdout.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Fingerprint of the whole perf suite's SOURCE: every file that defines what the
 * scenarios measure — `_harness.ts`, `_fixtures.ts`, `_helpers.ts`, and every
 * `scenarios/*.ts` module, enumerated sorted for determinism.
 *
 * Unlike the per-scenario fingerprint (which covers one scenario's definition and call
 * sites), this catches edits ANYWHERE in the suite — e.g. a fixture payload change inside
 * `_fixtures.ts` — so the regression gate can refuse to compare two revisions whose
 * workloads are not byte-identical. A `--filter`ed run hashes the same files, so filtered
 * reports stay comparable with each other.
 */
async function suiteFingerprint(): Promise<string> {
  const suiteDir = import.meta.dir;
  const scenarioFiles = (await readdir(join(suiteDir, "scenarios"))).filter((f) => f.endsWith(".ts")).sort();
  const files = ["_harness.ts", "_fixtures.ts", "_helpers.ts", ...scenarioFiles.map((f) => join("scenarios", f))];

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(suiteDir, file)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** Collects environment metadata so a report is interpretable months later. */
async function collectMeta(label?: string): Promise<PerfReport["meta"]> {
  const commit = await git("rev-parse", "HEAD");
  const status = await git("status", "--porcelain");
  return {
    commit: commit || "unknown",
    dirty: status.length > 0,
    // The JavaScriptCore revision is part of the identity of a measurement, and Bun
    // reports it only as a commit hash — the first 7 chars are enough to tell builds apart.
    runtime: `Bun ${Bun.version} (webkit ${process.versions.webkit?.slice(0, 7) ?? "unknown"})`,
    cpu: cpus()[0]?.model ?? "unknown",
    os: `${process.platform} ${process.arch}`,
    date: new Date().toISOString(),
    suiteFingerprint: await suiteFingerprint(),
    ...(label ? { label } : {}),
  };
}

/** Renders results as an aligned per-group table. */
function renderTable(results: readonly ScenarioResult[]): string {
  const lines: string[] = [];
  const groups = [...new Set(results.map((r) => r.group))];

  for (const group of groups) {
    const rows = results.filter((r) => r.group === group);
    lines.push("", `## ${group}`, "");

    const head = ["scenario", "per unit", "units/sec", "±rme", "extra"];
    const body = rows.map((r) => [
      r.name,
      formatNs(r.nsPerUnit),
      r.unitsPerSec >= 1000 ? `${Math.round(r.unitsPerSec).toLocaleString("en-US")}` : r.unitsPerSec.toFixed(1),
      `${r.rme.toFixed(1)}%`,
      r.extra
        ? Object.entries(r.extra)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")
        : "",
    ]);

    const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
    const pad = (row: string[]): string =>
      row
        .map((c, i) => c.padEnd(widths[i]))
        .join("  ")
        .trimEnd();
    lines.push(pad(head), widths.map((w) => "-".repeat(w)).join("  "));
    for (const row of body) lines.push(pad(row));
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const label = flag(args, "label");
  const out = flag(args, "out");
  const filter = flag(args, "filter");

  const all = registeredScenarios();
  const selected = filter ? all.filter((s) => s.name.includes(filter) || s.group.includes(filter)) : all;

  if (selected.length === 0) {
    console.error(
      `No scenarios matched --filter ${filter}. Registered groups: ${[...new Set(all.map((s) => s.group))].join(", ")}`,
    );
    process.exit(1);
  }

  console.error(`Running ${selected.length} scenario(s)...`);
  const results: ScenarioResult[] = [];
  for (const def of selected) {
    console.error(`  ${def.name}`);
    results.push(await runScenario(def));
  }

  const report: PerfReport = { schema: 1, meta: await collectMeta(label), scenarios: results };

  console.log(`\n# Performance report`);
  console.log(`\ncommit ${report.meta.commit.slice(0, 8)}${report.meta.dirty ? " (dirty)" : ""}`);
  console.log(`${report.meta.runtime} on ${report.meta.cpu}`);
  console.log(renderTable(results));

  if (out) {
    // `--out` is relative to the working directory, like every other path argument.
    await mkdir(dirname(out), { recursive: true }).catch(() => {});
    await Bun.write(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${out}`);
  }
}
