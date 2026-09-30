/** Offline active-route throughput and historical-key retention; optional SDK directory compares revisions. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const sdk = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL("../../", import.meta.url);
const { frameEventType, _routedTypeCacheSizeForTests } = await import(
  new URL("src/transport/websocket/_routing.ts", sdk).href
);
const channels = ["userFills", "userFundings", "userHistoricalOrders"];
const throughput = [];
for (const channel of channels) {
  const data = { user: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" };
  const samples: number[] = [];
  for (let block = 0; block < 13; block++) {
    const started = performance.now();
    for (let i = 0; i < 250000; i++) frameEventType(channel, data);
    if (block >= 3) samples.push(((performance.now() - started) * 1e6) / 250000);
  }
  throughput.push({ channel, nsPerFrame: samples.sort((a, b) => a - b)[5] });
}
Bun.gc(true);
await new Promise((resolve) => setTimeout(resolve, 0));
const before = process.memoryUsage().heapUsed;
const retainedBytes: number[] = [];
for (let pass = 0; pass < 2; pass++) {
  for (const channel of channels) {
    for (let i = 0; i < 100000; i++)
      frameEventType(channel, { user: `0x${(pass * 100000 + i).toString(16).padStart(40, "0")}` });
  }
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  retainedBytes.push(process.memoryUsage().heapUsed - before);
}
console.log(
  JSON.stringify(
    {
      runtime: Bun.version,
      throughput,
      uniqueHistoricalKeys: [300000, 600000],
      retainedBytes,
      cachedKeys: channels.map((channel) => ({ channel, keys: _routedTypeCacheSizeForTests?.(channel) ?? null })),
    },
    null,
    2,
  ),
);
