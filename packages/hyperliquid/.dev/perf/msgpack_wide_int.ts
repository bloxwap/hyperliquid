/**
 * Offline micro-benchmark for the wide-integer arm of the L1 msgpack encoder (`MsgpackWriter.numberL1`).
 *
 * The fingerprinted suite in `tests/perf` has no action carrying integers wider than 32 bits, so it cannot
 * see this arm. This script measures it directly: it builds the pre-change counterfactual (every wide safe
 * integer widened through `BigInt`) from the CURRENT `_msgpack.ts` source in a temporary directory, asserts
 * both writers emit identical bytes, then times them in paired rounds with the variant order rotated each
 * round so warmup and thermal drift hit both sides. Production files are never changed.
 *
 * Usage: `bun run .dev/perf/msgpack_wide_int.ts [--rounds 15]` (or `node` 24+, which strips the types)
 * @module
 */
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { type L1Value, MsgpackWriter } from "../../src/signing/_msgpack.ts";

const roundsIndex = process.argv.indexOf("--rounds");
const rounds = roundsIndex >= 0 ? Number(process.argv[roundsIndex + 1]) : 15;
const NONCE = 1_700_000_000_000;
/** A realistic live order ID: above 2^32, so every one takes the wide arm. */
const OID = 41_234_567_890;
const ORDER = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } };

/** The production wide arm, and the single call it replaced. */
const WIDE_ARM =
  /this\.ensure\(9\);\n\s*this\.buffer\[this\.offset\] = value < 0 \? 0xd3 : 0xcf;[\s\S]*?this\.offset \+= 9;/;
const BIGINT_ARM = "this.bigint(BigInt(value));";

const workloads: { name: string; wideIntegers: number; action: L1Value }[] = [
  {
    // The arm in isolation: a bare array of wide integers, no maps or strings around them.
    name: "wide_ints_1000",
    wideIntegers: 1000,
    action: Array.from({ length: 1000 }, (_, i) => OID + i * 7919),
  },
  {
    name: "cancel_1",
    wideIntegers: 1,
    action: { type: "cancel", cancels: [{ a: 0, o: OID }] },
  },
  {
    name: "cancel_100",
    wideIntegers: 100,
    action: { type: "cancel", cancels: Array.from({ length: 100 }, (_, i) => ({ a: i % 50, o: OID + i })) },
  },
  {
    name: "cancel_1000",
    wideIntegers: 1000,
    action: { type: "cancel", cancels: Array.from({ length: 1000 }, (_, i) => ({ a: i % 50, o: OID + i })) },
  },
  {
    name: "batch_modify_100",
    wideIntegers: 100,
    action: {
      type: "batchModify",
      modifies: Array.from({ length: 100 }, (_, i) => ({ oid: OID + i, order: { ...ORDER, a: i % 50 } })),
    },
  },
  {
    // Control: no wide integers, so both writers should run the same code.
    name: "order_100_control",
    wideIntegers: 0,
    action: { type: "order", orders: Array.from({ length: 100 }, (_, i) => ({ ...ORDER, a: i % 50 })), grouping: "na" },
  },
];

const source = await readFile(new URL("../../src/signing/_msgpack.ts", import.meta.url), "utf8");
assert.match(source, WIDE_ARM, "the wide-integer arm moved; update WIDE_ARM before trusting these numbers");
const directory = await mkdtemp(join(tmpdir(), "hyperliquid-msgpack-wide-"));
let sink = 0;

try {
  await writeFile(join(directory, "bigint.ts"), source.replace(WIDE_ARM, BIGINT_ARM));
  const { MsgpackWriter: BigIntWriter } = (await import(pathToFileURL(join(directory, "bigint.ts")).href)) as {
    MsgpackWriter: typeof MsgpackWriter;
  };

  const results = [];
  for (const { name, wideIntegers, action } of workloads) {
    const writers = { bigint: new BigIntWriter(), split: new MsgpackWriter() };
    /** The L1 hash preimage (action ‖ nonce ‖ no-vault marker) hashed with keccak, as signing does. */
    const hash = (writer: MsgpackWriter): Uint8Array => {
      writer.reset();
      writer.valueL1(action);
      writer.uint64(NONCE);
      writer.byte(0);
      return keccak_256(writer.view());
    };
    const encodeOnly = (writer: MsgpackWriter): number => {
      writer.reset();
      writer.valueL1(action);
      return writer.view()[0];
    };
    assert.deepEqual(hash(writers.split), hash(writers.bigint), `${name}: preimage bytes differ`);

    for (const [mode, run] of [
      ["encode", (writer: MsgpackWriter) => encodeOnly(writer)],
      ["hash", (writer: MsgpackWriter) => hash(writer)[0]],
    ] as const) {
      const variants = Object.entries(writers);
      const samples = variants.map(() => [] as number[]);
      const iterations = Math.max(200, Math.floor(100_000 / Math.max(1, wideIntegers + 10)));
      for (const [, writer] of variants) for (let i = 0; i < iterations; i++) sink ^= run(writer);
      for (let round = 0; round < rounds; round++) {
        for (let k = 0; k < variants.length; k++) {
          const index = (k + round) % variants.length;
          const writer = variants[index][1];
          const start = performance.now();
          for (let i = 0; i < iterations; i++) sink ^= run(writer);
          samples[index].push(((performance.now() - start) * 1e6) / iterations);
        }
      }
      const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const [bigintNs, splitNs] = samples.map(median);
      // Per-round ratios, so a drifting round affects both sides of its own ratio.
      const ratio = median(samples[1].map((split, round) => split / samples[0][round]));
      results.push({
        workload: `${name}/${mode}`,
        bigintNs: Number(bigintNs.toFixed(1)),
        splitNs: Number(splitNs.toFixed(1)),
        change: `${((ratio - 1) * 100).toFixed(1)}%`,
        savedNsPerWideInt: wideIntegers ? Number(((bigintNs - splitNs) / wideIntegers).toFixed(1)) : null,
      });
    }
  }
  console.table(results);
  console.log(
    `runtime ${typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`}, ${rounds} rounds`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
// Keeps every measured result observable, so the JIT cannot drop the work being timed.
if (sink === -1) console.log(sink);
