/**
 * Paired L1 MessagePack benchmark for omitted versus explicit undefined optional properties.
 *
 * Creates a temporary pre-change counterfactual by restoring the old rewind/count branch in the
 * current writer. Both variants must emit identical bytes and hashes. Variant order alternates per
 * round; results are per complete action, excluding network and signature costs. The fingerprinted
 * workload under tests/perf is intentionally unchanged.
 *
 * Usage from the SDK directory: `bun .dev/perf/msgpack_undefined.ts [--rounds 11]`
 * @module
 */
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { L1Value, MsgpackWriter } from "../../src/signing/_msgpack.ts";

const roundsIndex = process.argv.indexOf("--rounds");
const rounds = roundsIndex < 0 ? 11 : Number(process.argv[roundsIndex + 1]);
assert(Number.isSafeInteger(rounds) && rounds > 0, "--rounds must be a positive integer");
const source = await readFile(new URL("../../src/signing/_msgpack.ts", import.meta.url), "utf8");
const branch = "this.mapL1Omitted(value, { keys, omittedKey: key, headerAt, reservedHeaderSize: headerSize });";
assert.equal(source.split(branch).length, 2, "the omission branch moved; update the counterfactual first");
const directory = await mkdtemp(join(tmpdir(), "hyperliquid-msgpack-undefined-"));
let sink = 0;

try {
  const beforePath = join(directory, "rewind.ts");
  await writeFile(
    beforePath,
    source.replace(branch, "this.offset = headerAt;\n        this.mapL1Counted(value, keys);"),
  );
  await writeFile(join(directory, "continued.ts"), source);
  const { MsgpackWriter: ContinuedWriter } = (await import(pathToFileURL(join(directory, "continued.ts")).href)) as {
    MsgpackWriter: typeof MsgpackWriter;
  };
  const { MsgpackWriter: RewindWriter } = (await import(pathToFileURL(beforePath).href)) as {
    MsgpackWriter: typeof MsgpackWriter;
  };
  const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const results = [];
  for (const size of [1, 100, 1000]) {
    for (const rootUndefined of [false, true]) {
      for (const childUndefined of [false, true]) {
        const action: L1Value = {
          type: "order",
          orders: Array.from({ length: size }, (_, index) => ({
            a: index % 50,
            b: true,
            p: "30000",
            s: "0.001",
            r: false,
            t: { limit: { tif: "Gtc" } },
            ...(childUndefined ? { c: undefined } : {}),
          })),
          grouping: "na",
          ...(rootUndefined ? { builder: undefined } : {}),
        };
        const writers = [new RewindWriter(), new ContinuedWriter()];
        const encode = (writer: MsgpackWriter): Uint8Array => {
          writer.reset();
          writer.valueL1(action);
          return writer.view();
        };
        assert.deepEqual(encode(writers[0]), encode(writers[1]), "action bytes differ");
        for (const hashing of [false, true]) {
          const run = (writer: MsgpackWriter): number => {
            encode(writer);
            if (!hashing) return writer.view()[0];
            writer.uint64(1_700_000_000_000);
            writer.byte(0);
            return keccak_256(writer.view())[0];
          };
          assert.equal(run(writers[0]), run(writers[1]));
          const samples = [[], []] as [number[], number[]];
          const iterations = Math.max(20, Math.floor(10_000 / size));
          for (let round = -3; round < rounds; round++) {
            for (let variant = 0; variant < 2; variant++) {
              const index = (variant + round + 4) % 2;
              const start = performance.now();
              for (let iteration = 0; iteration < iterations; iteration++) sink ^= run(writers[index]);
              if (round >= 0) samples[index].push(((performance.now() - start) * 1e6) / iterations);
            }
          }
          const beforeNs = median(samples[0]);
          const afterNs = median(samples[1]);
          const ratio = median(samples[1].map((value, round) => value / samples[0][round]));
          results.push({
            orders: size,
            rootUndefined,
            childUndefined,
            mode: hashing ? "hash" : "encode",
            beforeUs: Number((beforeNs / 1000).toFixed(3)),
            afterUs: Number((afterNs / 1000).toFixed(3)),
            change: `${((ratio - 1) * 100).toFixed(1)}%`,
          });
        }
      }
    }
  }
  console.log(JSON.stringify({ runtime: process.versions, rounds, results, sink }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
