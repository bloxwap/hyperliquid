/**
 * Offline rewritten-echo scaling and compound-route fanout. An optional SDK directory measures
 * another revision without changing the regression suite's workload or fingerprint.
 *
 * Run from the SDK: bun .dev/perf/ws_subset_routing.ts [/path/to/comparison-sdk]
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sdk = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL("../../", import.meta.url);
const { WebSocketDispatcher } = await import(new URL("src/transport/websocket/_dispatcher.ts", sdk).href);
const { HyperliquidEventTarget } = await import(new URL("src/transport/websocket/_events.ts", sdk).href);
const { payloadEventType } = await import(new URL("src/transport/websocket/_routing.ts", sdk).href);

class Socket extends EventTarget {
  readyState = 1;
  terminationSignal = new AbortController().signal;
  send(): void {}
  frame(channel: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ channel, data }) }));
  }
}

async function rewrittenBurst(count: number, inspect: boolean): Promise<number> {
  const socket = new Socket();
  const events = new HyperliquidEventTarget(socket);
  const dispatcher = new WebSocketDispatcher(socket, events, null);
  const pending = Array.from({ length: count }, (_, i) =>
    dispatcher.request("subscribe", { type: "l2Book", coin: `COIN${i}` }),
  );
  let reads = 0;
  if (inspect) {
    for (const entry of dispatcher._queue) {
      const request = entry.echo.request;
      Object.defineProperty(entry.echo, "request", {
        get: () => {
          reads++;
          return request;
        },
      });
    }
  }
  for (let i = 0; i < count; i++) {
    socket.frame("subscriptionResponse", {
      method: "subscribe",
      subscription: { type: "l2Book", coin: `COIN${i}`, nSigFigs: null, mantissa: null },
    });
    // Real socket responses arrive in separate tasks, allowing settled entries to dequeue.
    await Promise.resolve();
  }
  await Promise.all(pending);
  return reads;
}

const rewritten = [];
for (const subscriptions of [100, 500, 1000]) {
  const normalizedRequestReads = await rewrittenBurst(subscriptions, true);
  const samples = [];
  for (let round = 0; round < 10; round++) {
    const started = performance.now();
    await rewrittenBurst(subscriptions, false);
    if (round >= 3) samples.push(((performance.now() - started) * 1000) / subscriptions);
  }
  samples.sort((a, b) => a - b);
  rewritten.push({ subscriptions, normalizedRequestReads, medianUsPerSubscription: samples[3] });
}

const socket = new Socket();
const events = new HyperliquidEventTarget(socket);
let candleListenersInvoked = 0;
for (const interval of ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"]) {
  events.addEventListener(payloadEventType("candle", { coin: "BTC", interval }), () => candleListenersInvoked++);
}
socket.frame("candle", { s: "BTC", i: "1m" });
console.log(
  JSON.stringify(
    {
      runtime: typeof Bun === "undefined" ? `Node ${process.version}` : `Bun ${Bun.version}`,
      sdk: sdk.href,
      rewritten,
      candleListenersInvoked,
    },
    null,
    2,
  ),
);
