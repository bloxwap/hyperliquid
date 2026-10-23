/**
 * Paired bounded-dispatch burst measurements, outside the regression-suite workload.
 * Run from the repo root: bun packages/hyperliquid/.dev/perf/bounded_dispatch.ts --compare-ref <git-ref>
 * Focus small lanes with --counts 1,10,50 --max-overtakes 99 --bursts 2000 --rounds 21.
 * Counts cancellation registrations separately from timings so instrumentation is not timed.
 * Timings exclude signing/network work; managed HTTP/WS behavior is tested in _runtimeIntegration.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as current from "../../src/api/exchange/_methods/_base/_dispatch.ts";

type Dispatcher = Pick<typeof current, "reserveDispatch">;
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const ref = flag("--compare-ref");
const out = flag("--out");
const directory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(directory, "../../../..");
const source = "packages/hyperliquid/src/api/exchange/_methods/_base/_dispatch.ts";
let temporary: string | undefined;
let baseline: Dispatcher | undefined;
if (ref !== undefined) {
  temporary = await mkdtemp(join(tmpdir(), "bounded-dispatch-baseline-"));
  // Preserve the ref's implementation but resolve its dependency imports against this checkout.
  const before = execFileSync("git", ["show", `${ref}:${source}`], { cwd: repo, encoding: "utf8" }).replace(
    /from "(\.\.?\/[^"]+)"/g,
    (_match, specifier: string) =>
      `from ${JSON.stringify(pathToFileURL(resolve(repo, dirname(source), specifier)).href)}`,
  );
  const file = join(temporary, "dispatch.ts");
  await writeFile(file, before);
  baseline = await import(pathToFileURL(file).href);
}
let sequence = 0;
async function microtasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
async function burst(
  dispatcher: Dispatcher,
  count: number,
  maxOvertakes: number,
  pendingResponses: boolean,
  countListeners: boolean,
): Promise<number> {
  const key = `measurement-${++sequence}`;
  const reservations = Array.from({ length: count }, (_, i) =>
    dispatcher.reserveDispatch(key, i + 1, { maxOvertakes, maxPending: count }),
  );
  let registrations = 0;
  const signals = countListeners
    ? Array.from({ length: count }, () => {
        const signal = new AbortController().signal;
        const add = signal.addEventListener.bind(signal);
        signal.addEventListener = (...params: Parameters<AbortSignal["addEventListener"]>): void => {
          if (params[0] === "abort") registrations++;
          add(...params);
        };
        return signal;
      })
    : undefined;
  const sent: number[] = [];
  const requests: Promise<void>[] = [];
  for (let i = count - 1; i >= 0; i--) {
    requests.push(
      reservations[i].wait(signals?.[i]).then(() => {
        sent.push(i);
        if (!pendingResponses) reservations[i].release();
      }),
    );
  }
  if (pendingResponses) {
    let completed = 0;
    while (completed < count) {
      await microtasks();
      while (completed < sent.length) reservations[sent[completed++]].release();
    }
  }
  await Promise.all(requests);
  if (sent.length !== count || new Set(sent).size !== count) throw new Error("Missing/duplicate dispatch");
  if (maxOvertakes === 0 && sent.some((index, position) => index !== position)) throw new Error("Wire order changed");
  return registrations;
}
const median = (values: number[]): number => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const results: object[] = [];
function positiveOption(name: string, fallback: number): number {
  const value = Number(flag(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}
const rounds = positiveOption("--rounds", 15);
const burstsPerBlock = positiveOption("--bursts", 20);
const warmupBlocks = positiveOption("--warmup-blocks", 5);
const counts = (flag("--counts") ?? "1,10,50,100,128,129,200").split(",").map(Number);
const caps = (flag("--max-overtakes") ?? "0,99").split(",").map(Number);
if (counts.some((count) => !Number.isSafeInteger(count) || count < 1)) throw new RangeError("Invalid --counts");
if (caps.some((cap) => !Number.isSafeInteger(cap) || cap < 0 || cap > 99))
  throw new RangeError("Invalid --max-overtakes");
async function sample(
  dispatcher: Dispatcher,
  count: number,
  maxOvertakes: number,
  pendingResponses: boolean,
): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < burstsPerBlock; i++) await burst(dispatcher, count, maxOvertakes, pendingResponses, false);
  return ((performance.now() - start) * 1000) / burstsPerBlock;
}
try {
  for (const maxOvertakes of caps) {
    for (const pendingResponses of [false, true]) {
      for (const count of counts) {
        const variants =
          baseline === undefined
            ? [{ name: "current", dispatcher: current }]
            : [
                { name: "baseline", dispatcher: baseline },
                { name: "current", dispatcher: current },
              ];
        const timings = new Map<string, number[]>();
        for (const variant of variants) {
          timings.set(variant.name, []);
        }
        for (let block = 0; block < warmupBlocks; block++) {
          for (const variant of block % 2 === 0 ? variants : variants.toReversed()) {
            await sample(variant.dispatcher, count, maxOvertakes, pendingResponses);
          }
        }
        for (let round = 0; round < rounds; round++) {
          for (const variant of round % 2 === 0 ? variants : variants.toReversed()) {
            timings.get(variant.name)!.push(await sample(variant.dispatcher, count, maxOvertakes, pendingResponses));
          }
        }
        const measurements = [];
        for (const variant of variants) {
          measurements.push({
            variant: variant.name,
            medianBurstUs: median(timings.get(variant.name)!),
            samplesUs: timings.get(variant.name),
            cancellationRegistrations: await burst(variant.dispatcher, count, maxOvertakes, pendingResponses, true),
          });
        }
        const pairedRatios =
          baseline === undefined
            ? undefined
            : timings.get("current")!.map((value, i) => value / timings.get("baseline")![i]);
        const row = {
          count,
          maxOvertakes,
          pendingResponses,
          measurements,
          pairedRatios,
          medianRatio: pairedRatios === undefined ? undefined : median(pairedRatios),
        };
        results.push(row);
        console.log(
          JSON.stringify({
            ...row,
            measurements: measurements.map(({ samplesUs: _, ...summary }) => summary),
            pairedRatios: undefined,
          }),
        );
      }
    }
  }
  if (out !== undefined)
    await writeFile(
      out,
      `${JSON.stringify({ runtime: process.versions.bun === undefined ? `Node ${process.version}` : `Bun ${process.versions.bun}`, versions: process.versions, compareRef: ref, rounds, burstsPerBlock, warmupBlocks, results }, null, 2)}\n`,
    );
} finally {
  if (temporary !== undefined) await rm(temporary, { recursive: true, force: true });
}
