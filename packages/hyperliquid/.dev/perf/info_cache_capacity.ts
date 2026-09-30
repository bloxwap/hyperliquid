/** Offline bounded-cache diagnostic; optional SDK directory compares the same workload across revisions. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const sdk = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL("../../", import.meta.url);
const { InfoCacheTransport } = await import(new URL("src/transport/_infoCache.ts", sdk).href);
const now = Date.now;
let clock = 0;
Date.now = (): number => clock;
const inner = { isTestnet: false, request: (): Promise<unknown> => Promise.resolve({ ok: true }) };
const results = [];
try {
  for (const maxSize of [100, 1000, 10000]) {
    for (const mode of ["infinite", "fresh-finite", "mixed-expiry", "hit", "passthrough"]) {
      clock = 0;
      const cache = new InfoCacheTransport(inner, {
        maxSize,
        ttl: mode === "fresh-finite" ? 60000 : Infinity,
        ttlByType: mode === "mixed-expiry" ? { marginTable: 10 } : {},
      });
      let id = 0;
      const payload = (n: number): object =>
        mode === "mixed-expiry" && n % 4 === 0
          ? { type: "marginTable", id: n }
          : { type: "tokenDetails", tokenId: String(n) };
      for (; id < maxSize; id++) await cache.request("info", payload(id));
      const samples: number[] = [];
      for (let block = 0; block < 13; block++) {
        const start = performance.now();
        for (let i = 0; i < 2000; i++, id++) {
          if (mode === "mixed-expiry") clock++;
          await cache.request(
            "info",
            mode === "hit" ? payload(maxSize - 1) : mode === "passthrough" ? { type: "allMids" } : payload(id),
          );
        }
        if (block >= 3) samples.push(((performance.now() - start) * 1000) / 2000);
      }
      results.push({ maxSize, mode, usPerRequest: samples.sort((a, b) => a - b)[5] });
    }
  }
} finally {
  Date.now = now;
}
console.log(JSON.stringify({ runtime: Bun.version, results }, null, 2));
