/** Compare rate-limited transport CPU and request parsing for reused owned actions. @module */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const compareAt = args.indexOf("--compare-dir");
const sdk = resolve(import.meta.dir, "../..");
const directories = compareAt < 0 ? [sdk] : [resolve(args[compareAt + 1]), sdk];
const encoder = new TextEncoder();
const variants = await Promise.all(
  directories.map(async (directory) => {
    const load = (file: string) => import(pathToFileURL(resolve(directory, "src", file)).href);
    const [http, orders, wire] = await Promise.all([
      load("transport/http/mod.ts"),
      load("api/exchange/_methods/order.ts"),
      load("transport/_wire.ts"),
    ]);
    return { directory, http, orders, wire };
  }),
);

for (const count of [1, 100, 1000]) {
  const scenarios = variants.map(({ directory, http, orders, wire }) => {
    const action = orders.buildOrder({
      orders: Array.from({ length: count }, () => ({
        a: 0,
        b: true,
        p: "30000",
        s: "0.1",
        r: false,
        t: { limit: { tif: "Gtc" } },
      })),
    }).payload;
    let nonce = 1_700_000_000_000;
    let bytes = 0;
    const transport = new http.HttpTransport({
      timeout: null,
      rateLimit: { capacity: 1e9, refillPerMinute: 1e9 },
      fetch: async (_url: unknown, init: RequestInit) => {
        bytes += encoder.encode(init.body as string).byteLength;
        return Response.json({ ok: true });
      },
    });
    const run = async () => {
      const payload = { action, signature: { r: "0x11", s: "0x22", v: 27 }, nonce: nonce++ };
      wire.registerExchangeWireRequest(payload, action);
      await transport.request("exchange", payload);
    };
    return { directory, run, samples: [] as number[], bytes: () => bytes };
  });
  const iterations = 100;
  for (let round = -3; round < 11; round++) {
    const ordered = round % 2 === 0 ? scenarios : [...scenarios].reverse();
    for (const scenario of ordered) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) await scenario.run();
      if (round >= 0) scenario.samples.push(((performance.now() - start) * 1000) / iterations);
    }
  }
  for (const scenario of scenarios) {
    // Count in a separate pass so instrumentation cannot inflate the measured CPU cost.
    const parse = JSON.parse;
    const iterate = Array.prototype[Symbol.iterator];
    let batchElementsVisited = 0;
    Array.prototype[Symbol.iterator] = function* () {
      for (const value of iterate.call(this)) {
        if (this.length === count) batchElementsVisited++;
        yield value;
      }
      return undefined;
    };
    let parses = 0;
    let characters = 0;
    JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown => {
      if (text.includes('"orders"')) {
        parses++;
        characters += text.length;
      }
      return parse(text, reviver);
    }) as typeof JSON.parse;
    try {
      for (let i = 0; i < 10; i++) await scenario.run();
    } finally {
      JSON.parse = parse;
      Array.prototype[Symbol.iterator] = iterate;
    }
    const sorted = [...scenario.samples].sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        directory: scenario.directory,
        orders: count,
        medianUsPerRequest: sorted[Math.floor(sorted.length / 2)],
        p90UsPerRequest: sorted[Math.ceil(sorted.length * 0.9) - 1],
        warmRequestParsesPer10: parses,
        warmParsedCharactersPer10: characters,
        warmBatchElementsVisitedPer10: batchElementsVisited,
        outgoingBytes: scenario.bytes(),
      }),
    );
  }
}
