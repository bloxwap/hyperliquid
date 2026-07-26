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
  iterations: 1,
  samples: 8,
  warmupSamples: 2,
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
