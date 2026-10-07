/**
 * One-operation entry points against their client and API barrel, on the published package.
 * bun run build && bun .dev/perf/entry_points.ts [--samples 15] [--out /tmp/entry-points.json]
 *
 * For one representative operation per family (Info `allMids`, Exchange `order`, Subscription
 * `allMids`), three consumers do the same job through the client, the API barrel and the
 * operation's own entry point. Reported per consumer:
 * - modules and evaluatedBytes: files Node evaluates for the consumer (its static import closure
 *   inside `dist/`, transport included) and their combined size;
 * - minified and gzip bytes of an esbuild bundle of the consumer, dependencies external;
 * - cold import median on Node and Bun: a fresh process that imports the entry point and its
 *   transport, timed from inside the process so runtime boot is excluded.
 *
 * Consumers alternate inside every round so machine drift hits each one equally. Numbers are
 * wall-clock timings of the local machine, useful as ratios rather than absolutes.
 * @module
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(import.meta.dir, "../..");
const dist = join(root, "dist");
const samplesIndex = process.argv.indexOf("--samples");
const samples = samplesIndex >= 0 ? Number(process.argv[samplesIndex + 1]) : 15;
const outIndex = process.argv.indexOf("--out");

/** One way to perform a family's representative operation. */
interface Consumer {
  family: string;
  style: "client" | "barrel" | "operation";
  /** Subpath of the operation's module, after `@bloxwap/hyperliquid/`. */
  path: string;
  binding: string;
  /** Subpath of the transport the operation needs. */
  transport: string;
  /** Statement that performs the operation with `transport` and `wallet` in scope. */
  call: string;
}

const order = `{ orders: [{ a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" } } }], grouping: "na" }`;
const families = [
  {
    family: "info",
    transport: "transport/http",
    client: ["api/info/client", "InfoClient", "await new InfoClient({ transport }).allMids();"],
    operation: ["api/info/allMids", "allMids", "await allMids({ transport });"],
    barrel: ["api/info", "allMids", "await allMids({ transport });"],
  },
  {
    family: "exchange",
    transport: "transport/http",
    client: [
      "api/exchange/client",
      "ExchangeClient",
      `await new ExchangeClient({ transport, wallet }).order(${order});`,
    ],
    operation: ["api/exchange/order", "order", `await order({ transport, wallet }, ${order});`],
    barrel: ["api/exchange", "order", `await order({ transport, wallet }, ${order});`],
  },
  {
    family: "subscription",
    transport: "transport/websocket",
    client: [
      "api/subscription/client",
      "SubscriptionClient",
      "await new SubscriptionClient({ transport }).allMids(console.log);",
    ],
    operation: ["api/subscription/allMids", "allMids", "await allMids({ transport }, console.log);"],
    barrel: ["api/subscription", "allMids", "await allMids({ transport }, console.log);"],
  },
] as const;
const consumers: Consumer[] = families.flatMap(({ family, transport, ...styles }) =>
  (["client", "barrel", "operation"] as const).map((style) => {
    const [path, binding, call] = styles[style];
    return { family, style, path, binding, transport, call };
  }),
);

/** Files Node evaluates for `entries` (their static import closure inside `dist/`) and their total size. */
async function evaluated(...entries: string[]): Promise<{ modules: number; bytes: number }> {
  const pending = [...entries];
  const seen = new Set<string>();
  let bytes = 0;
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await Bun.file(file).text();
    bytes += Buffer.byteLength(code);
    for (const match of code.matchAll(/\b(?:from\s*|import\s*)"(\.{1,2}\/[^"\n]+)"/g)) {
      pending.push(resolve(dirname(file), match[1]));
    }
  }
  return { modules: seen.size, bytes };
}

const manifest = (await Bun.file(join(dist, "package.json")).json()).exports as Record<
  string,
  { default: string } | null
>;

/** `dist/` file an export subpath resolves to, following the published manifest's patterns. */
function distFile(subpath: string): string {
  const explicit = manifest[`./${subpath}`];
  if (explicit) return join(dist, explicit.default);
  const [, family, name] = subpath.match(/^api\/([^/]+)\/([^/]+)$/)!;
  return join(dist, "api", family, "_methods", `${name}.js`);
}

const consumerDir = await mkdtemp(join(tmpdir(), "hl-entry-points-"));
try {
  await mkdir(join(consumerDir, "node_modules", "@bloxwap"), { recursive: true });
  await symlink(dist, join(consumerDir, "node_modules", "@bloxwap", "hyperliquid"), "dir");
  await writeFile(join(consumerDir, "package.json"), '{"type":"module"}\n');

  const rows = new Map<Consumer, Record<string, unknown>>();
  for (const consumer of consumers) {
    const transportClass = consumer.transport === "transport/http" ? "HttpTransport" : "WebSocketTransport";
    const code = `import { ${consumer.binding} } from "@bloxwap/hyperliquid/${consumer.path}";
      import { ${transportClass} } from "@bloxwap/hyperliquid/${consumer.transport}";
      const transport = new ${transportClass}();
      const wallet = globalThis.wallet;
      ${consumer.call}`;
    const bundle = await build({
      stdin: { contents: code, resolveDir: consumerDir },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      minify: true,
      external: ["valibot", "@noble/hashes/*", "hash-wasm", "tiny-secp256k1"],
    });
    const bytes = bundle.outputFiles[0].contents;
    const { modules, bytes: evaluatedBytes } = await evaluated(distFile(consumer.path), distFile(consumer.transport));
    rows.set(consumer, {
      family: consumer.family,
      style: consumer.style,
      entry: consumer.path,
      modules,
      evaluatedBytes,
      minBytes: bytes.length,
      gzipBytes: gzipSync(bytes).length,
    });
  }

  for (const [runtime, label] of [
    ["node", "node"],
    [process.execPath, "bun"],
  ] as const) {
    const times = new Map(consumers.map((consumer) => [consumer, [] as number[]]));
    for (let round = 0; round < samples; round++) {
      for (const consumer of consumers) {
        const script = `const start = performance.now();
          await Promise.all([import("@bloxwap/hyperliquid/${consumer.path}"), import("@bloxwap/hyperliquid/${consumer.transport}")]);
          console.log(performance.now() - start);`;
        const child = Bun.spawn([runtime, "--input-type=module", "-e", script], {
          cwd: consumerDir,
          stderr: "inherit",
        });
        const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        if (exit !== 0) throw new Error(`Importing ${consumer.path} failed under ${label}`);
        times.get(consumer)!.push(Number(output));
      }
    }
    for (const [consumer, rounds] of times) {
      const sorted = [...rounds].sort((a, b) => a - b);
      rows.get(consumer)![`${label}Ms`] = Number(sorted[Math.floor(sorted.length / 2)].toFixed(2));
    }
  }

  const results = [...rows.values()];
  console.table(results);
  const report = { node: process.versions.node, bun: Bun.version, samples, results };
  if (outIndex >= 0) await writeFile(process.argv[outIndex + 1], `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(consumerDir, { recursive: true, force: true });
}
