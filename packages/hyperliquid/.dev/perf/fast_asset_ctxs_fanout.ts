/** Offline per-frame fan-out diagnostic. Run with an optional SDK directory to compare revisions. */
import { deflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const sdk = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL("../../", import.meta.url);
const { WebSocketTransport, WebSocketQuota } = await import(new URL("src/transport/websocket/mod.ts", sdk).href);
const { SubscriptionClient } = await import(new URL("src/api/subscription/client.ts", sdk).href);
const { installMockWebSocket, lastMockWebSocket, restoreWebSocket } = await import(
  new URL("tests/perf/_helpers.ts", sdk).href
);
const results = [];
for (const coins of [320, 6]) {
  const ctxs: Record<string, { markPx: string; midPx: string }> = {};
  for (let i = 0; i < coins; i++)
    ctxs[`COIN${i}`] = { markPx: (1000 + i * 1.37).toFixed(4), midPx: (1000 + i * 1.36).toFixed(4) };
  const frame = JSON.stringify({
    channel: "fastAssetCtxs",
    data: Buffer.from(deflateRawSync(Buffer.from(JSON.stringify(ctxs)))).toString("base64"),
  });
  for (const listeners of [1, 5, 10]) {
    installMockWebSocket();
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws", quota: new WebSocketQuota() });
    try {
      await transport.ready();
      const client = new SubscriptionClient({ transport });
      let delivered = 0;
      for (let i = 0; i < listeners; i++)
        await client.fastAssetCtxs(() => {
          delivered++;
        });
      const socket = lastMockWebSocket();
      const samples: number[] = [];
      const frames = coins === 320 ? 100 : 2000;
      for (let block = 0; block < 13; block++) {
        const started = performance.now();
        for (let i = 0; i < frames; i++) socket.dispatchEvent(new MessageEvent("message", { data: frame }));
        const us = ((performance.now() - started) * 1000) / frames;
        if (block >= 3) samples.push(us);
      }
      if (delivered !== 13 * frames * listeners)
        throw new Error("Missing synchronous deliveries; this diagnostic requires native inflate.");
      results.push({ coins, listeners, usPerFrame: samples.sort((a, b) => a - b)[5] });
    } finally {
      transport.close();
      restoreWebSocket();
    }
  }
}
console.log(JSON.stringify({ runtime: Bun.version, sdk: sdk.pathname, results }, null, 2));
