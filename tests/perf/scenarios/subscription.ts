/**
 * WebSocket subscription throughput: the read side of a trading system.
 *
 * These scenarios run against {@linkcode MockWebSocket}, so no network is involved and the
 * measured cost is entirely the SDK's dispatch machinery.
 *
 * The headline metric is `invocationsPerTick`: with K subscriptions on one channel, how many
 * listeners does a single incoming frame run? Dispatching by channel name alone makes that K
 * (K-1 of which immediately discard the event); routing by subscription identity makes it 1.
 * Wall-clock per frame follows the same curve, so both are reported — the count is the
 * mechanism, the timing is the consequence.
 * @module
 */

import {
  type ISubscription,
  SubscriptionClient,
  type WebSocketRequestError,
  WebSocketTransport,
} from "@bloxwap/hyperliquid";
import { scenario } from "../_harness.ts";
import { installMockWebSocket, lastMockWebSocket, type MockWebSocket, restoreWebSocket } from "../_helpers.ts";

/** Number of distinct coin subscriptions sharing the `l2Book` channel. */
const COIN_SUBSCRIPTIONS = 50;
/** Frames injected per measured sample. */
const FRAMES = 500;
/** Subscriptions in flight during the reconnect burst scenario. */
const BURST_SUBSCRIPTIONS = 500;
/** Book levels per side in the e2e l2Book frame. */
const BOOK_LEVELS = 20;

interface DispatchContext {
  transport: WebSocketTransport;
  socket: MockWebSocket;
  coins: string[];
  /** Listener invocations counted at the `transport.subscribe()` boundary. */
  counter: { transportLevel: number; delivered: number };
}

/**
 * Wraps `transport.subscribe` so every listener invocation is counted *before* the SDK's
 * own per-subscription filtering runs. Counting inside the user callback would only see
 * events that survived filtering, which is precisely the number this scenario must not measure.
 */
function countingTransport(transport: WebSocketTransport, counter: { transportLevel: number }): void {
  const original = transport.subscribe.bind(transport);
  const counting: typeof transport.subscribe = <T>(
    channel: string,
    payload: unknown,
    listener: (data: CustomEvent<T>) => void,
    options?: { signal?: AbortSignal; onError?: (error: WebSocketRequestError) => void },
  ): Promise<ISubscription> =>
    original<T>(
      channel,
      payload,
      (event: CustomEvent<T>) => {
        counter.transportLevel++;
        listener(event);
      },
      options,
    );
  transport.subscribe = counting;
}

scenario({
  name: "subscription/l2book_dispatch_50_coins",
  group: "subscription",
  description:
    `l2Book frame dispatch with ${COIN_SUBSCRIPTIONS} coin subscriptions on one channel; ` +
    `reports listener invocations per frame`,
  unit: "frame",
  unitsPerIteration: FRAMES,
  iterations: 1,
  samples: 10,
  setup: async (): Promise<DispatchContext> => {
    installMockWebSocket();
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
    await transport.ready();
    const socket = lastMockWebSocket();

    const counter = { transportLevel: 0, delivered: 0 };
    countingTransport(transport, counter);

    const client = new SubscriptionClient({ transport });
    const coins = Array.from({ length: COIN_SUBSCRIPTIONS }, (_, i) => `PERF${i}`);
    for (const coin of coins) {
      await client.l2Book({ coin }, () => counter.delivered++);
    }

    return { transport, socket, coins, counter };
  },
  run: ({ socket, coins, counter }: DispatchContext) => {
    // Reset per sample so the reported ratio describes this sample's frames only.
    counter.transportLevel = 0;
    counter.delivered = 0;

    // Every frame targets the SAME coin, so exactly one subscription is genuinely interested.
    for (let i = 0; i < FRAMES; i++) {
      socket.serverSend({
        channel: "l2Book",
        data: {
          coin: coins[0],
          time: i,
          levels: [[{ px: "100", sz: "1", n: 1 }], [{ px: "101", sz: "1", n: 1 }]],
        },
      });
    }

    return {
      invocationsPerTick: counter.transportLevel / FRAMES,
      deliveredPerTick: counter.delivered / FRAMES,
    };
  },
  teardown: ({ transport }: DispatchContext) => {
    transport.close();
    restoreWebSocket();
  },
});

scenario({
  name: "subscription/subscribe_200_coins",
  group: "subscription",
  description: "Cost of establishing 200 l2Book subscriptions (per-subscribe bookkeeping and user-limit scans)",
  unit: "subscription",
  unitsPerIteration: 200,
  // A sample builds 200 subscriptions, so iterations cannot be raised; more samples is the
  // only lever available against an otherwise ~40% margin of error.
  iterations: 1,
  samples: 25,
  warmupSamples: 3,
  setup: () => {
    installMockWebSocket();
  },
  run: async () => {
    // A fresh transport per sample: subscription state accumulates, and the per-subscribe
    // cost this scenario measures is a function of how many already exist.
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
    await transport.ready();
    const client = new SubscriptionClient({ transport });

    for (let i = 0; i < 200; i++) {
      await client.l2Book({ coin: `SUB${i}` }, () => {});
    }
    transport.close();
  },
  teardown: () => {
    restoreWebSocket();
  },
});

scenario({
  name: "subscription/reconnect_resubscribe_burst",
  group: "subscription",
  description:
    `Reconnect re-subscribe burst: ${BURST_SUBSCRIPTIONS} subscribe requests in flight, then ` +
    `${BURST_SUBSCRIPTIONS} subscriptionResponse echoes; the echo phase alone is reported as echoNsPerFrame`,
  unit: "echo",
  unitsPerIteration: BURST_SUBSCRIPTIONS,
  iterations: 1,
  samples: 10,
  warmupSamples: 2,
  setup: () => {
    installMockWebSocket();
  },
  run: async () => {
    // A fresh transport per sample: the burst's cost is a function of how many requests are in
    // flight, and a reused transport would only accumulate settled subscriptions.
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
    await transport.ready();
    const socket = lastMockWebSocket();

    // Suppress the mock's auto-answer: every subscribe must still be in flight when the echoes
    // arrive, which is exactly the reconnect shape this scenario measures.
    const frames: string[] = [];
    socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView): void => {
      frames.push(String(data));
    };

    const client = new SubscriptionClient({ transport });
    const subs = Array.from({ length: BURST_SUBSCRIPTIONS }, (_, i) => client.l2Book({ coin: `BURST${i}` }, () => {}));

    // The server echoes each subscription verbatim, one frame per task; the microtask flushes
    // let each confirmed request dequeue before the next echo, as on a real socket.
    const echoes = frames.map((frame) => {
      const { method, subscription } = JSON.parse(frame) as { method: string; subscription: unknown };
      return { channel: "subscriptionResponse", data: { method, subscription } };
    });
    const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));
    const echoStart = performance.now();
    for (const echo of echoes) {
      socket.serverSend(echo);
      await flush();
      await flush();
    }
    const echoNs = (performance.now() - echoStart) * 1e6;

    await Promise.all(subs);
    transport.close();
    return { echoNsPerFrame: echoNs / echoes.length, echoes: echoes.length };
  },
  teardown: () => {
    restoreWebSocket();
  },
});

interface FrameDispatchContext {
  transport: WebSocketTransport;
  socket: MockWebSocket;
  counter: { delivered: number };
  /** The raw l2Book frame text, serialized once in setup. */
  frameText: string;
}

scenario({
  name: "subscription/l2book_frame_dispatch_e2e",
  group: "subscription",
  description:
    `End-to-end dispatch of a raw ${BOOK_LEVELS}-level l2Book frame: JSON text on the socket ` +
    `through parse and routing to the subscribed listener`,
  unit: "frame",
  unitsPerIteration: FRAMES,
  iterations: 1,
  samples: 10,
  setup: async (): Promise<FrameDispatchContext> => {
    installMockWebSocket();
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
    await transport.ready();
    const socket = lastMockWebSocket();

    const counter = { delivered: 0 };
    const client = new SubscriptionClient({ transport });
    await client.l2Book({ coin: "BTC" }, () => counter.delivered++);

    // The frame text is pre-serialized: `serverSend` would stringify per frame and bill that
    // to the scenario, while the cost under measurement starts at the socket's JSON.parse.
    const level = (i: number): { px: string; sz: string; n: number } => ({ px: `${30_000 + i}`, sz: "1.5", n: i % 7 });
    const frameText = JSON.stringify({
      channel: "l2Book",
      data: {
        coin: "BTC",
        time: 1_700_000_000_000,
        levels: [
          Array.from({ length: BOOK_LEVELS }, (_, i) => level(i)),
          Array.from({ length: BOOK_LEVELS }, (_, i) => level(i + BOOK_LEVELS)),
        ],
      },
    });

    return { transport, socket, counter, frameText };
  },
  run: ({ socket, counter, frameText }: FrameDispatchContext) => {
    counter.delivered = 0;
    for (let i = 0; i < FRAMES; i++) {
      socket.dispatchEvent(new MessageEvent("message", { data: frameText }));
    }
    return { deliveredPerTick: counter.delivered / FRAMES };
  },
  teardown: ({ transport }: FrameDispatchContext) => {
    transport.close();
    restoreWebSocket();
  },
});
