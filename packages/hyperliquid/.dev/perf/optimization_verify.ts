/**
 * Pair the actual SDK before/after implementations, including signing and both wire transports.
 * <bun|node> .dev/perf/optimization_verify.ts --compare-dir <original package snapshot> --out /tmp/verify.json
 * The snapshot needs src/, package.json, and access to the same node_modules. No network calls.
 * --filter staged limits the run to separate sign/submit; other scenario substrings also work.
 * @module
 */
import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const compareIndex = process.argv.indexOf("--compare-dir");
assert(compareIndex >= 0, "Pass --compare-dir pointing to the original SDK package snapshot");
const compareDir = resolve(process.argv[compareIndex + 1]);
const filterIndex = process.argv.indexOf("--filter");
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : undefined;
const matches = (scenario: string): boolean => filter === undefined || scenario.includes(filter);
async function sdk(url: URL) {
  const load = (file: string) => import(new URL(`src/${file}`, url).href);
  const [order, execution, l1, keccak, http, ws, quota, wallet] = await Promise.all([
    load("api/exchange/_methods/order.ts"),
    load("actions/execution.ts"),
    load("signing/_l1.ts"),
    load("signing/_keccak.ts"),
    load("transport/http/mod.ts"),
    load("transport/websocket/mod.ts"),
    load("transport/websocket/_quota.ts"),
    load("signing/_fastWallet.ts"),
  ]);
  return { ...order, ...execution, ...l1, ...keccak, ...http, ...ws, ...quota, ...wallet };
}
const variants = {
  before: await sdk(pathToFileURL(`${compareDir}/`)),
  after: await sdk(new URL("../../", import.meta.url)),
};
const sampleCount = 11;
const results: { scenario: string; variant: string; medianUs: number; p90Us: number; roundsUs: number[] }[] = [];
let sink = 0;
const nonce = 1_700_000_000_000;
const input = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };
const encoder = new TextEncoder();
const ok = { status: "ok", response: { type: "default" } };
const signature = `0x${"11".repeat(64)}1b` as const;

function record(group: string, names: string[], rounds: number[][]): void {
  names.forEach((variant, i) => {
    const sorted = [...rounds[i]].sort((a, b) => a - b);
    const result = {
      scenario: group,
      variant,
      medianUs: sorted[Math.floor(sorted.length / 2)],
      p90Us: sorted[Math.ceil(sorted.length * 0.9) - 1],
      roundsUs: rounds[i],
    };
    results.push(result);
    console.log(`${group}/${variant}: ${result.medianUs.toFixed(3)} us`);
  });
}

function paired(group: string, cases: Record<string, (i: number) => number>, iterations: number): void {
  const entries = Object.entries(cases);
  const rounds = entries.map(() => [] as number[]);
  for (let round = -3; round < sampleCount; round++)
    for (let index = 0; index < entries.length; index++) {
      const selected = (index + round + entries.length * 3) % entries.length;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) sink ^= entries[selected][1](i);
      if (round >= 0) rounds[selected].push(((performance.now() - start) * 1000) / iterations);
    }
  record(
    group,
    entries.map(([name]) => name),
    rounds,
  );
}

async function pairedAsync(
  group: string,
  cases: Record<string, (i: number) => Promise<void>>,
  iterations: number,
): Promise<void> {
  const entries = Object.entries(cases);
  const rounds = entries.map(() => [] as number[]);
  for (let round = -3; round < sampleCount; round++)
    for (let index = 0; index < entries.length; index++) {
      const selected = (index + round + entries.length * 3) % entries.length;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) await entries[selected][1](i);
      if (round >= 0) rounds[selected].push(((performance.now() - start) * 1000) / iterations);
    }
  record(
    group,
    entries.map(([name]) => name),
    rounds,
  );
}

class Socket extends EventTarget {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  protocol = "";
  extensions = "";
  lastFrame = "";
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(data: string): void {
    this.lastFrame = data;
    sink ^= encoder.encode(data).length;
    const id = Number(/^\{"method":"post","id":(\d+),/.exec(data)?.[1]);
    assert(Number.isSafeInteger(id));
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ channel: "post", data: { id, response: { type: "action", payload: ok } } }),
        }),
      ),
    );
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1000, reason: "", wasClean: true }));
  }
}

for (const provider of ["wasm", "noble"]) {
  for (const impl of Object.values(variants)) {
    impl._setKeccakLoaderForTests(provider === "noble" ? async () => undefined : undefined);
    await impl.preloadWasmKeccak();
  }
  for (const count of [1, 4, 8, 10, 100, 1000]) {
    const scenario = `hash_${provider}_${count}`;
    if (!matches(scenario)) continue;
    const cases: Record<string, (i: number) => number> = {};
    let expected: Uint8Array | undefined;
    for (const [name, impl] of Object.entries(variants)) {
      const built = impl.buildOrder({ orders: Array.from({ length: count }, () => input) });
      const mutable = structuredClone(built.payload);
      const actual = impl.createL1ActionHashBytes({ action: built.payload, nonce });
      if (expected) assert.deepEqual(actual, expected);
      expected = actual;
      for (const [ownership, action] of Object.entries({ owned: built.payload, mutable })) {
        cases[`${name}_${ownership}`] = (i) => impl.createL1ActionHashBytes({ action, nonce: nonce + i })[0];
      }
    }
    paired(scenario, cases, Math.max(50, Math.floor(5000 / count)));
  }
}
for (const impl of Object.values(variants)) {
  impl._setKeccakLoaderForTests(undefined);
  await impl.preloadWasmKeccak();
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

try {
  for (const path of ["execute", "staged"])
    for (const curve of ["stub", "wasm"])
      for (const count of [1, 8, 100, 1000])
        for (const wire of ["memory", "http", "ws"]) {
          const scenario = `${path}_${curve}_${wire}_${count}`;
          if (!matches(scenario)) continue;
          const cases: Record<string, (i: number) => Promise<void>> = {};
          const close: (() => Promise<void>)[] = [];
          for (const [name, impl] of Object.entries(variants)) {
            const action = impl.buildOrder({ orders: Array.from({ length: count }, () => input) });
            let nextNonce = nonce;
            const wallet =
              curve === "wasm"
                ? await impl.createFastLocalWallet(`0x${"11".repeat(32)}`)
                : {
                    address: "0x1111111111111111111111111111111111111111",
                    sign: async () => signature,
                    signTypedData: async () => signature,
                  };
            let transport: {
              isTestnet: boolean;
              request: (...args: unknown[]) => Promise<unknown>;
              close?: () => Promise<void>;
              ready?: () => Promise<void>;
            };
            if (wire === "memory")
              transport = {
                isTestnet: true,
                async request() {
                  return ok;
                },
              };
            else if (wire === "http") {
              globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
                sink ^= encoder.encode(init.body as string).length;
                return new Response(JSON.stringify(ok), { headers: { "Content-Type": "application/json" } });
              }) as typeof fetch;
              transport = new impl.HttpTransport({ isTestnet: true, timeout: null });
            } else {
              let socket!: Socket;
              globalThis.WebSocket = class extends Socket {
                constructor() {
                  super();
                  socket = this;
                  queueMicrotask(() => this.open());
                }
              } as unknown as typeof WebSocket;
              transport = new impl.WebSocketTransport({
                isTestnet: true,
                timeout: null,
                keepAlive: { interval: 60_000 },
                quota: new impl.WebSocketQuota(),
              });
              await transport.ready!();
              assert(socket.readyState === 1);
              close.push(() => transport.close!());
            }
            const config = { wallet, transport, nonceManager: () => nextNonce++ };
            cases[name] = async () => {
              if (path === "execute") await impl.executeAction(config, action);
              else await impl.submitAction(config, await impl.signAction(config, action));
            };
          }
          try {
            await pairedAsync(scenario, cases, count === 1000 ? 50 : 150);
          } finally {
            for (const dispose of close) await dispose();
          }
        }
} finally {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
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
        compareDir,
        filter,
        sampleCount,
        sink,
        results,
      },
      null,
      2,
    )}\n`,
  );
