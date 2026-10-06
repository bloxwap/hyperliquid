/**
 * Three offline optimization experiments, kept outside the fingerprinted regression suite.
 * Run with Bun or Node 24+: <runtime> .dev/perf/optimization_search.ts --out /tmp/search.json
 * Rotates paired variants, checks identical bytes, varies nonces, and measures cold setup separately.
 * @module
 */
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { buildOrder } from "../../src/api/exchange/_methods/order.ts";
import { MsgpackWriter, type L1Value } from "../../src/signing/_msgpack.ts";

const sampleCount = 11;
const results: { scenario: string; medianUs: number; p90Us: number; roundsUs: number[] }[] = [];
let sink = 0;
const baseNonce = 1_700_000_000_000;
const input = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };
const wasm = await import("hash-wasm").then(
  (m) => m.createKeccak(256),
  () => undefined,
);

function paired(group: string, variants: Record<string, (i: number) => number>, iterations: number): void {
  const entries = Object.entries(variants);
  const rounds = entries.map(() => [] as number[]);
  for (let round = -3; round < sampleCount; round++) {
    for (let index = 0; index < entries.length; index++) {
      const selected = (index + round + entries.length * 3) % entries.length;
      const run = entries[selected][1];
      const start = performance.now();
      for (let i = 0; i < iterations; i++) sink ^= run(i);
      if (round >= 0) rounds[selected].push(((performance.now() - start) * 1000) / iterations);
    }
  }
  entries.forEach(([name], i) => {
    const sorted = [...rounds[i]].sort((a, b) => a - b);
    const result = {
      scenario: `${group}/${name}`,
      medianUs: sorted[Math.floor(sorted.length / 2)],
      p90Us: sorted[Math.ceil(sorted.length * 0.9) - 1],
      roundsUs: rounds[i],
    };
    results.push(result);
    console.log(`${result.scenario}: ${result.medianUs.toFixed(3)} us`);
  });
}

const directory = await mkdtemp(join(tmpdir(), "hyperliquid-ocean-"));
try {
  const source = await readFile(new URL("../../src/signing/_msgpack.ts", import.meta.url), "utf8");
  const singleAscii = source.replace(
    "    const length = value.length;\n    if (length >= 4294967296)",
    `    const length = value.length;
    if (length === 1 && value.charCodeAt(0) <= 0x7f) {
      this.ensure(2);
      this.buffer[this.offset++] = 0xa1;
      this.buffer[this.offset++] = value.charCodeAt(0);
      return;
    }
    if (length >= 4294967296)`,
  );
  assert.notEqual(singleAscii, source);
  const keyCache = source.replaceAll("this.string(key);", "this.mapKey(key);").replace(
    "  private string(value: string): void {",
    `  private readonly keys = new Map<string, Uint8Array>();
  private mapKey(value: string): void {
    let bytes = this.keys.get(value);
    if (bytes === undefined) {
      const start = this.offset;
      this.string(value);
      if (this.keys.size < 64) this.keys.set(value, this.buffer.slice(start, this.offset));
      return;
    }
    this.raw(bytes);
  }
  private string(value: string): void {`,
  );
  const writers: Record<string, MsgpackWriter> = { current: new MsgpackWriter() };
  for (const [name, variant] of Object.entries({ single_ascii: singleAscii, cached_keys: keyCache })) {
    const path = join(directory, `${name}.ts`);
    await writeFile(path, variant);
    const { MsgpackWriter: Writer } = await import(pathToFileURL(path).href);
    writers[name] = new Writer();
  }

  for (const count of [1, 10, 100, 1000]) {
    const action = buildOrder({ orders: Array.from({ length: count }, (_, i) => ({ ...input, a: i % 100 })) });
    const mutable = structuredClone(action.payload);
    const writer = new MsgpackWriter();
    writer.valueL1(action.payload as L1Value);
    const prefix = writer.view().slice();
    const nobleState = keccak_256.create().update(prefix);
    let wasmState: Uint8Array | undefined;
    if (wasm) {
      wasm.init();
      wasm.update(prefix);
      wasmState = wasm.save();
    }
    const fullWriter = new MsgpackWriter();
    const tailWriter = new MsgpackWriter();
    const full = (i: number): Uint8Array => {
      fullWriter.reset();
      fullWriter.raw(prefix);
      fullWriter.uint64(baseNonce + i);
      fullWriter.byte(0);
      return fullWriter.view();
    };
    const tail = (i: number): Uint8Array => {
      tailWriter.reset();
      tailWriter.uint64(baseNonce + i);
      tailWriter.byte(0);
      return tailWriter.view();
    };
    const resumeNoble = (i: number): Uint8Array => nobleState.clone().update(tail(i)).digest();
    const resumeWasm = (i: number): Uint8Array => {
      wasm!.load(wasmState!);
      wasm!.update(tail(i));
      return wasm!.digest("binary");
    };
    for (const i of [0, 1, 255, 65536]) {
      const expected = keccak_256(full(i));
      assert.deepEqual(resumeNoble(i), expected);
      if (wasm) assert.deepEqual(resumeWasm(i), expected);
    }
    const iterations = Math.max(100, Math.floor(30_000 / count));
    paired(
      `checkpoint_${count}`,
      {
        noble_full: (i) => keccak_256(full(i))[0],
        noble_resume: (i) => resumeNoble(i)[0],
        noble_cold: (i) => keccak_256.create().update(prefix).clone().update(tail(i)).digest()[0],
        ...(wasm
          ? {
              wasm_full: (i: number) => {
                wasm.init();
                wasm.update(full(i));
                return wasm.digest("binary")[0];
              },
              wasm_resume: (i: number) => resumeWasm(i)[0],
              wasm_cold: (i: number) => {
                wasm.init();
                wasm.update(prefix);
                const state = wasm.save();
                wasm.load(state);
                wasm.update(tail(i));
                return wasm.digest("binary")[0];
              },
            }
          : {}),
      },
      iterations,
    );

    writer.reset();
    writer.valueL1(mutable as L1Value);
    const reference = writer.view().slice();
    for (const candidate of Object.values(writers)) {
      candidate.reset();
      candidate.valueL1(mutable as L1Value);
      assert.deepEqual(candidate.view(), reference);
    }
    paired(
      `atoms_${count}`,
      Object.fromEntries(
        Object.entries(writers).map(([name, candidate]) => [
          name,
          () => {
            candidate.reset();
            candidate.valueL1(mutable as L1Value);
            return candidate.view()[0];
          },
        ]),
      ),
      iterations,
    );

    const signature = { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: 27 };
    const signatureJSON = JSON.stringify(signature);
    const actionJSON = JSON.stringify(action.payload);
    const reusedJSON = (i: number): string =>
      `{"action":${actionJSON},"signature":${signatureJSON},"nonce":${baseNonce + i}}`;
    const request = (i: number) => ({ action: action.payload, signature, nonce: baseNonce + i });
    for (const i of [0, 1, 255]) assert.equal(reusedJSON(i), JSON.stringify(request(i)));
    paired(
      `wire_${count}`,
      {
        full_json: (i) => JSON.stringify(request(i)).length,
        action_fragment: (i) => reusedJSON(i).length,
        // Encoding forces the concatenation to materialize, as a real socket/fetch must.
        full_json_utf8: (i) => new TextEncoder().encode(JSON.stringify(request(i))).length,
        action_fragment_utf8: (i) => new TextEncoder().encode(reusedJSON(i)).length,
      },
      iterations,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0)
  await writeFile(
    process.argv[outIndex + 1],
    `${JSON.stringify(
      {
        runtime: process.versions,
        cpu: cpus()[0]?.model,
        date: new Date().toISOString(),
        sampleCount,
        sink,
        results,
      },
      null,
      2,
    )}\n`,
  );
