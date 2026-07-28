/**
 * User-account channel dispatch: the frames a balance/position feed lives on.
 *
 * The channels that replaced the retired aggregate `webData2` — `clearinghouseState`
 * (main-perp clearing), `spotState` (spot balances), and `webData3` (account metadata incl.
 * abstraction mode) — are the hot path of every consumer that shows a user their money, so
 * their end-to-end dispatch cost is benchmarked directly: raw JSON text on the socket through
 * parse, route-key derivation, and user-filtered delivery to the subscribed listener.
 *
 * `user_dispatch_50_users` proves the `BY_USER` route: with K users subscribed on one channel,
 * a frame for one user runs exactly one listener (`deliveredPerTick` = 1) — the property that
 * lets consumers delete their hand-rolled stale-frame guards.
 *
 * `subscribe_user_trio` measures establishing the three account subscriptions for one user —
 * the calls a feed makes at session start and on every reconnect.
 * @module
 */

import { SubscriptionClient, WebSocketTransport } from "@bloxwap/hyperliquid";
import { scenario } from "../_harness.ts";
import { installMockWebSocket, lastMockWebSocket, type MockWebSocket, restoreWebSocket } from "../_helpers.ts";

/** Frames injected per measured sample. */
const FRAMES = 500;
/** Open positions in the clearinghouseState frame. */
const POSITIONS = 10;
/** Token balances in the spotState frame. */
const BALANCES = 20;
/**
 * Users sharing the channel in the BY_USER routing scenario, in addition to the target user.
 * The server tracks at most 15 unique users per connection (mirrored client-side by
 * `MAX_UNIQUE_USERS`), so 14 + the target saturates the allowed crowd exactly.
 */
const USER_SUBSCRIPTIONS = 14;

const USER = "0x1111111111111111111111111111111111111111" as const;

interface FrameDispatchContext {
  transport: WebSocketTransport;
  socket: MockWebSocket;
  counter: { delivered: number };
  /** The raw frame text, serialized once in setup. */
  frameText: string;
}

/** One open position, shaped like the mainnet `clearinghouseState` payload. */
function position(i: number): unknown {
  return {
    type: "oneWay",
    position: {
      coin: `PERF${i}`,
      szi: i % 2 === 0 ? "1.5" : "-0.75",
      leverage: { type: "cross", value: 20 },
      entryPx: `${30_000 + i}`,
      positionValue: `${45_000 + i * 100}`,
      unrealizedPnl: `${(i - POSITIONS / 2) * 12.5}`,
      returnOnEquity: "0.0313",
      liquidationPx: null,
      marginUsed: `${2_250 + i * 5}`,
      maxLeverage: 25,
      cumFunding: { allTime: "18.44", sinceOpen: "-2.11", sinceChange: "0.03" },
    },
  };
}

/** The three account frames, serialized once so a sample measures dispatch, not stringify. */
const FRAME_TEXTS = {
  clearinghouseState: JSON.stringify({
    channel: "clearinghouseState",
    data: {
      dex: "",
      user: USER,
      clearinghouseState: {
        marginSummary: {
          accountValue: "152340.77",
          totalNtlPos: "98450.12",
          totalRawUsd: "121100.55",
          totalMarginUsed: "4922.51",
        },
        crossMarginSummary: {
          accountValue: "152340.77",
          totalNtlPos: "98450.12",
          totalRawUsd: "121100.55",
          totalMarginUsed: "4922.51",
        },
        crossMaintenanceMarginUsed: "1230.63",
        withdrawable: "147418.26",
        assetPositions: Array.from({ length: POSITIONS }, (_, i) => position(i)),
        time: 1_700_000_000_000,
      },
    },
  }),
  spotState: JSON.stringify({
    channel: "spotState",
    data: {
      user: USER,
      spotState: {
        balances: Array.from({ length: BALANCES }, (_, i) => ({
          coin: i === 0 ? "USDC" : `TOKEN${i}`,
          token: i,
          total: `${1_000 + i * 7.25}`,
          hold: `${i % 3}`,
          entryNtl: `${900 + i * 6.5}`,
        })),
      },
    },
  }),
  webData3: JSON.stringify({
    channel: "webData3",
    data: {
      userState: {
        agentAddress: null,
        agentValidUntil: null,
        cumLedger: "152340.77",
        serverTime: 1_700_000_000_000,
        isVault: false,
        user: USER,
        abstraction: "disabled",
      },
      perpDexStates: [{ totalVaultEquity: "0.0" }],
    },
  }),
} as const;

type AccountChannel = keyof typeof FRAME_TEXTS;

/**
 * Registers an end-to-end dispatch scenario for one account channel: subscribes one user,
 * then times raw frame text through the socket's parse and routing to the listener.
 * `deliveredPerTick` must stay 1 — below 1 means the route or the method's own filter
 * dropped a frame meant for us.
 */
function frameDispatchScenario(
  channel: AccountChannel,
  subscribe: (client: SubscriptionClient, listener: () => void) => Promise<unknown>,
): void {
  scenario({
    name: `subscription/${channel}_frame_dispatch_e2e`,
    group: "subscription",
    description:
      `End-to-end dispatch of a raw ${channel} frame ` +
      `(mainnet-sized payload) from socket JSON text to the subscribed listener`,
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
      await subscribe(client, () => counter.delivered++);

      return { transport, socket, counter, frameText: FRAME_TEXTS[channel] };
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
}

frameDispatchScenario("clearinghouseState", (client, listener) => client.clearinghouseState({ user: USER }, listener));

frameDispatchScenario("spotState", (client, listener) => client.spotState({ user: USER }, listener));

frameDispatchScenario("webData3", (client, listener) => client.webData3({ user: USER }, listener));

scenario({
  name: "subscription/user_dispatch_15_users",
  group: "subscription",
  description:
    `clearinghouseState dispatch with ${USER_SUBSCRIPTIONS} users on one channel; ` +
    `a frame for one user must run exactly one listener (BY_USER route)`,
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
    for (let i = 0; i < USER_SUBSCRIPTIONS; i++) {
      const user = `0x${String(i + 2).padStart(40, "0")}` as `0x${string}`;
      await client.clearinghouseState({ user }, () => counter.delivered++);
    }
    // The frame targets USER, distinct from all of the above: exactly one subscription is
    // genuinely interested, so `deliveredPerTick` must be 1 despite the crowd on the channel.
    await client.clearinghouseState({ user: USER }, () => counter.delivered++);

    return { transport, socket, counter, frameText: FRAME_TEXTS.clearinghouseState };
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

scenario({
  name: "subscription/subscribe_user_trio",
  group: "subscription",
  description:
    "Cost of establishing the three account subscriptions (clearinghouseState + spotState + webData3) " +
    "for one user — the calls a feed makes at session start and on every reconnect",
  unit: "subscription",
  unitsPerIteration: 3,
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

    await client.clearinghouseState({ user: USER }, () => {});
    await client.spotState({ user: USER }, () => {});
    await client.webData3({ user: USER }, () => {});
    transport.close();
  },
  teardown: () => {
    restoreWebSocket();
  },
});
