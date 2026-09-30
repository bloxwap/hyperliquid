/** Offline reload latency/counts via real HttpTransport with mocked 20ms RTT; optional SDK revision directory. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const sdk = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL("../../", import.meta.url);
const { SymbolConverter } = await import(new URL("src/utils/_symbolConverter.ts", sdk).href);
const { HttpTransport } = await import(new URL("src/transport/http/mod.ts", sdk).href);
const fetch = globalThis.fetch;
const results = [];
try {
  for (const count of [10, 267]) {
    const registry = [null, ...Array.from({ length: count }, (_, i) => ({ name: `dex${i}` }))];
    const metas = registry.map((dex, i) => ({
      universe: [{ name: i === 0 ? "BTC" : `${dex!.name}:A`, szDecimals: 3, maxLeverage: 20, marginTableId: 1 }],
      marginTables: [],
      collateralToken: 0,
    }));
    for (const paced of [false, true]) {
      const elapsed: number[] = [];
      let requests = 0;
      for (let sample = 0; sample < 3; sample++) {
        requests = 0;
        const mockFetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          requests++;
          const { type, dex } = JSON.parse(init!.body as string);
          await new Promise((resolve) => setTimeout(resolve, 20));
          const index = dex === undefined ? 0 : registry.findIndex((item) => item?.name === dex);
          const data: Record<string, unknown> = {
            meta: metas[index],
            allPerpMetas: metas,
            perpDexs: registry,
            spotMeta: { tokens: [], universe: [] },
            outcomeMeta: { outcomes: [], questions: [] },
          };
          return Response.json(data[type]);
        };
        globalThis.fetch = Object.assign(mockFetch, { preconnect: fetch.preconnect });
        // Accelerated diagnostic budget, not the production 1200/min default: exercises actual weighted pacing.
        const transport = new HttpTransport({
          timeout: null,
          rateLimit: paced ? { capacity: 80, refillPerMinute: 120000 } : undefined,
        });
        const started = performance.now();
        const converter = await SymbolConverter.create({ transport, dexs: true });
        elapsed.push(performance.now() - started);
        if (converter.getAssetId(`dex${count - 1}:A`) !== 100000 + count * 10000)
          throw new Error("Incorrect DEX offset");
      }
      results.push({ builderDexs: count, paced, requests, medianMs: elapsed.sort((a, b) => a - b)[1] });
    }
  }
} finally {
  globalThis.fetch = fetch;
}
console.log(
  JSON.stringify(
    { runtime: Bun.version, mockedRttMs: 20, pacingBudget: { capacity: 80, refillPerMinute: 120000 }, results },
    null,
    2,
  ),
);
