/**
 * Offline coverage tests for the Subscription API: every {@linkcode SubscriptionClient}
 * method is driven against a {@linkcode MockSubscriptionTransport} and asserted on three
 * concerns — the exact channel/payload/options handed to the transport, synchronous
 * {@linkcode ValidationError} rejection of bad params (before any transport call), and
 * event delivery through the wrapped listener (including per-method event filtering).
 *
 * @module
 */

import { describe, expect, spyOn, test } from "bun:test";
import {
  type ISubscription,
  type SubscriptionOptions,
  SubscriptionClient,
  ValidationError,
} from "@bloxwap/hyperliquid";
import { allMids, assetCtxs } from "@bloxwap/hyperliquid/api/subscription";
import { MockSubscriptionTransport } from "./_mockTransport.ts";

// =============================================================
// Fixtures
// =============================================================

const USER = "0x1111111111111111111111111111111111111111";
const OTHER_USER = "0x2222222222222222222222222222222222222222";

/** One row of the per-method coverage matrix. */
interface MethodCase {
  /** Method name, used as the describe label. */
  name: string;
  /** A valid call through the client. */
  subscribe: (
    client: SubscriptionClient,
    listener: (data: unknown) => void,
    options?: SubscriptionOptions,
  ) => Promise<ISubscription>;
  /** Calls that must throw {@linkcode ValidationError} synchronously, before any transport call. */
  invalid: ((client: SubscriptionClient) => unknown)[];
  /** Channel the transport is subscribed on (not always `payload.type`). */
  channel: string;
  /** Exact payload handed to the transport, after schema validation and normalization. */
  payload: Record<string, unknown>;
  /** Event detail that must reach the listener. */
  match: unknown;
  /** Event details that the wrapped listener must drop (empty when the channel is unfiltered). */
  misses: unknown[];
}

const CTX = { markPx: "1" };
const CLEARINGHOUSE_STATE = { marginSummary: { accountValue: "1" } };

const CASES: MethodCase[] = [
  {
    name: "activeAssetCtx",
    subscribe: (client, listener, options) => client.activeAssetCtx({ coin: "ETH" }, listener, options),
    invalid: [(client) => client.activeAssetCtx({ coin: 123 } as never, () => {})],
    channel: "activeAssetCtx",
    payload: { type: "activeAssetCtx", coin: "ETH" },
    match: { coin: "ETH", ctx: CTX },
    misses: [{ coin: "BTC", ctx: CTX }],
  },
  {
    name: "activeAssetData",
    subscribe: (client, listener, options) => client.activeAssetData({ coin: "ETH", user: USER }, listener, options),
    invalid: [
      (client) => client.activeAssetData({ coin: "ETH", user: "0x123" } as never, () => {}),
      (client) => client.activeAssetData({ coin: 123, user: USER } as never, () => {}),
    ],
    channel: "activeAssetData",
    payload: { type: "activeAssetData", coin: "ETH", user: USER },
    match: { coin: "ETH", user: USER, leverage: { type: "cross", value: 1 }, availableToTrade: "1" },
    misses: [
      { coin: "BTC", user: USER, leverage: { type: "cross", value: 1 }, availableToTrade: "1" },
      { coin: "ETH", user: OTHER_USER, leverage: { type: "cross", value: 1 }, availableToTrade: "1" },
    ],
  },
  {
    // Channel quirk: the wire payload keeps `type: "activeAssetCtx"`, but the transport is
    // subscribed on the "activeSpotAssetCtx" channel.
    name: "activeSpotAssetCtx",
    subscribe: (client, listener, options) => client.activeSpotAssetCtx({ coin: "@1" }, listener, options),
    invalid: [(client) => client.activeSpotAssetCtx({ coin: 123 } as never, () => {})],
    channel: "activeSpotAssetCtx",
    payload: { type: "activeAssetCtx", coin: "@1" },
    match: { coin: "@1", ctx: CTX },
    misses: [{ coin: "@2", ctx: CTX }],
  },
  {
    name: "allDexsAssetCtxs",
    subscribe: (client, listener, options) => client.allDexsAssetCtxs(listener, options),
    invalid: [],
    channel: "allDexsAssetCtxs",
    payload: { type: "allDexsAssetCtxs" },
    match: { ctxs: [["", [CTX]]] },
    misses: [],
  },
  {
    name: "allDexsClearinghouseState",
    subscribe: (client, listener, options) => client.allDexsClearinghouseState({ user: USER }, listener, options),
    invalid: [(client) => client.allDexsClearinghouseState({ user: "not-an-address" } as never, () => {})],
    channel: "allDexsClearinghouseState",
    payload: { type: "allDexsClearinghouseState", user: USER },
    match: { user: USER, clearinghouseStates: [["", CLEARINGHOUSE_STATE]] },
    misses: [{ user: OTHER_USER, clearinghouseStates: [["", CLEARINGHOUSE_STATE]] }],
  },
  {
    name: "allMids",
    subscribe: (client, listener, options) => client.allMids({ dex: "unit" }, listener, options),
    invalid: [(client) => client.allMids({ dex: 123 } as never, () => {})],
    channel: "allMids",
    payload: { type: "allMids", dex: "unit" },
    match: { mids: { BTC: "60000" }, dex: "unit" },
    misses: [{ mids: { BTC: "60000" } }, { mids: { BTC: "60000" }, dex: "other" }],
  },
  {
    name: "assetCtxs",
    subscribe: (client, listener, options) => client.assetCtxs({ dex: "unit" }, listener, options),
    invalid: [(client) => client.assetCtxs({ dex: 123 } as never, () => {})],
    channel: "assetCtxs",
    payload: { type: "assetCtxs", dex: "unit" },
    match: { dex: "unit", ctxs: [CTX] },
    misses: [{ dex: "", ctxs: [CTX] }],
  },
  {
    name: "bbo",
    subscribe: (client, listener, options) => client.bbo({ coin: "ETH" }, listener, options),
    invalid: [(client) => client.bbo({ coin: 123 } as never, () => {})],
    channel: "bbo",
    payload: { type: "bbo", coin: "ETH" },
    match: { coin: "ETH", time: 1, bbo: [null, null] },
    misses: [{ coin: "BTC", time: 1, bbo: [null, null] }],
  },
  {
    name: "candle",
    subscribe: (client, listener, options) => client.candle({ coin: "ETH", interval: "1h" }, listener, options),
    invalid: [
      (client) => client.candle({ coin: "ETH", interval: "7m" } as never, () => {}),
      (client) => client.candle({ coin: 123, interval: "1h" } as never, () => {}),
    ],
    channel: "candle",
    payload: { type: "candle", coin: "ETH", interval: "1h" },
    match: { t: 1, T: 2, s: "ETH", i: "1h", o: "1", c: "1", h: "1", l: "1", v: "1", n: 1 },
    misses: [
      { t: 1, T: 2, s: "BTC", i: "1h", o: "1", c: "1", h: "1", l: "1", v: "1", n: 1 },
      { t: 1, T: 2, s: "ETH", i: "1m", o: "1", c: "1", h: "1", l: "1", v: "1", n: 1 },
    ],
  },
  {
    name: "clearinghouseState",
    subscribe: (client, listener, options) => client.clearinghouseState({ user: USER }, listener, options),
    invalid: [
      (client) => client.clearinghouseState({ user: "0x123" } as never, () => {}),
      (client) => client.clearinghouseState({ user: USER, dex: 123 } as never, () => {}),
    ],
    channel: "clearinghouseState",
    payload: { type: "clearinghouseState", user: USER, dex: "" },
    match: { dex: "", user: USER, clearinghouseState: CLEARINGHOUSE_STATE },
    misses: [
      { dex: "", user: OTHER_USER, clearinghouseState: CLEARINGHOUSE_STATE },
      { dex: "unit", user: USER, clearinghouseState: CLEARINGHOUSE_STATE },
    ],
  },
  {
    name: "clearinghouseState (dex)",
    subscribe: (client, listener, options) => client.clearinghouseState({ user: USER, dex: "unit" }, listener, options),
    invalid: [],
    channel: "clearinghouseState",
    payload: { type: "clearinghouseState", user: USER, dex: "unit" },
    match: { dex: "unit", user: USER, clearinghouseState: CLEARINGHOUSE_STATE },
    misses: [{ dex: "", user: USER, clearinghouseState: CLEARINGHOUSE_STATE }],
  },
  {
    // Normalization: `nSigFigs`/`mantissa` default to null when omitted.
    name: "l2Book",
    subscribe: (client, listener, options) => client.l2Book({ coin: "ETH" }, listener, options),
    invalid: [
      (client) => client.l2Book({ coin: "ETH", nSigFigs: 6 } as never, () => {}),
      (client) => client.l2Book({ coin: "ETH", nSigFigs: "3" } as never, () => {}),
      (client) => client.l2Book({ coin: "ETH", mantissa: 3 } as never, () => {}),
      (client) => client.l2Book({ coin: "ETH", fast: "yes" } as never, () => {}),
    ],
    channel: "l2Book",
    payload: { type: "l2Book", coin: "ETH", nSigFigs: null, mantissa: null },
    match: { coin: "ETH", time: 1, levels: [[], []] },
    misses: [{ coin: "BTC", time: 1, levels: [[], []] }],
  },
  {
    name: "l2Book (nSigFigs + mantissa + fast)",
    subscribe: (client, listener, options) =>
      client.l2Book({ coin: "ETH", nSigFigs: 5, mantissa: 2, fast: true }, listener, options),
    invalid: [],
    channel: "l2Book",
    payload: { type: "l2Book", coin: "ETH", nSigFigs: 5, mantissa: 2, fast: true },
    match: { coin: "ETH", time: 1, levels: [[], []], spread: "1", fast: true },
    misses: [{ coin: "BTC", time: 1, levels: [[], []], spread: "1", fast: true }],
  },
  {
    name: "notification",
    subscribe: (client, listener, options) => client.notification({ user: USER }, listener, options),
    invalid: [(client) => client.notification({ user: "0x123" } as never, () => {})],
    channel: "notification",
    payload: { type: "notification", user: USER },
    match: { notification: "hello" },
    misses: [],
  },
  {
    name: "openOrders",
    subscribe: (client, listener, options) => client.openOrders({ user: USER }, listener, options),
    invalid: [(client) => client.openOrders({ user: "0x123" } as never, () => {})],
    channel: "openOrders",
    payload: { type: "openOrders", user: USER, dex: "" },
    match: { dex: "", user: USER, orders: [] },
    misses: [
      { dex: "", user: OTHER_USER, orders: [] },
      { dex: "unit", user: USER, orders: [] },
    ],
  },
  {
    name: "openOrders (dex)",
    subscribe: (client, listener, options) => client.openOrders({ user: USER, dex: "unit" }, listener, options),
    invalid: [],
    channel: "openOrders",
    payload: { type: "openOrders", user: USER, dex: "unit" },
    match: { dex: "unit", user: USER, orders: [] },
    misses: [{ dex: "", user: USER, orders: [] }],
  },
  {
    name: "orderUpdates",
    subscribe: (client, listener, options) => client.orderUpdates({ user: USER }, listener, options),
    invalid: [(client) => client.orderUpdates({ user: "0x123" } as never, () => {})],
    channel: "orderUpdates",
    payload: { type: "orderUpdates", user: USER },
    match: [],
    misses: [],
  },
  {
    name: "outcomeMetaUpdates",
    subscribe: (client, listener, options) => client.outcomeMetaUpdates(listener, options),
    invalid: [],
    channel: "outcomeMetaUpdates",
    payload: { type: "outcomeMetaUpdates" },
    match: { updates: [] },
    misses: [],
  },
  {
    name: "spotAssetCtxs",
    subscribe: (client, listener, options) => client.spotAssetCtxs(listener, options),
    invalid: [],
    channel: "spotAssetCtxs",
    payload: { type: "spotAssetCtxs" },
    match: [CTX],
    misses: [],
  },
  {
    name: "spotState",
    subscribe: (client, listener, options) => client.spotState({ user: USER }, listener, options),
    invalid: [
      (client) => client.spotState({ user: "0x123" } as never, () => {}),
      (client) => client.spotState({ user: USER, ignorePortfolioMargin: "yes" } as never, () => {}),
    ],
    channel: "spotState",
    payload: { type: "spotState", user: USER },
    match: { user: USER, spotState: { balances: [] } },
    misses: [{ user: OTHER_USER, spotState: { balances: [] } }],
  },
  {
    name: "spotState (ignorePortfolioMargin)",
    subscribe: (client, listener, options) =>
      client.spotState({ user: USER, ignorePortfolioMargin: true }, listener, options),
    invalid: [],
    channel: "spotState",
    payload: { type: "spotState", user: USER, ignorePortfolioMargin: true },
    match: { user: USER, spotState: { balances: [] } },
    misses: [{ user: OTHER_USER, spotState: { balances: [] } }],
  },
  {
    // Filter quirk: the first array element's `coin` decides (`e.detail[0]?.coin`), so an
    // empty array never matches.
    name: "trades",
    subscribe: (client, listener, options) => client.trades({ coin: "ETH" }, listener, options),
    invalid: [(client) => client.trades({ coin: 123 } as never, () => {})],
    channel: "trades",
    payload: { type: "trades", coin: "ETH" },
    match: [{ coin: "ETH", side: "B", px: "1", sz: "1", time: 1, hash: "0xabc" }],
    misses: [[{ coin: "BTC", side: "B", px: "1", sz: "1", time: 1, hash: "0xabc" }], []],
  },
  {
    name: "twapStates",
    subscribe: (client, listener, options) => client.twapStates({ user: USER }, listener, options),
    invalid: [(client) => client.twapStates({ user: "0x123" } as never, () => {})],
    channel: "twapStates",
    payload: { type: "twapStates", user: USER, dex: "" },
    match: { dex: "", user: USER, states: [] },
    misses: [
      { dex: "", user: OTHER_USER, states: [] },
      { dex: "unit", user: USER, states: [] },
    ],
  },
  {
    name: "twapStates (dex)",
    subscribe: (client, listener, options) => client.twapStates({ user: USER, dex: "unit" }, listener, options),
    invalid: [],
    channel: "twapStates",
    payload: { type: "twapStates", user: USER, dex: "unit" },
    match: { dex: "unit", user: USER, states: [] },
    misses: [{ dex: "", user: USER, states: [] }],
  },
  {
    // Channel quirk: the transport is subscribed on the shared "user" channel while the
    // payload keeps `type: "userEvents"`.
    name: "userEvents",
    subscribe: (client, listener, options) => client.userEvents({ user: USER }, listener, options),
    invalid: [(client) => client.userEvents({ user: "0x123" } as never, () => {})],
    channel: "user",
    payload: { type: "userEvents", user: USER },
    match: { fills: [] },
    misses: [],
  },
  {
    // Normalization: `aggregateByTime` defaults to false when omitted.
    name: "userFills",
    subscribe: (client, listener, options) => client.userFills({ user: USER }, listener, options),
    invalid: [
      (client) => client.userFills({ user: "0x123" } as never, () => {}),
      (client) => client.userFills({ user: USER, aggregateByTime: "yes" } as never, () => {}),
    ],
    channel: "userFills",
    payload: { type: "userFills", user: USER, aggregateByTime: false },
    match: { user: USER, fills: [] },
    misses: [{ user: OTHER_USER, fills: [] }],
  },
  {
    name: "userFills (aggregateByTime)",
    subscribe: (client, listener, options) =>
      client.userFills({ user: USER, aggregateByTime: true }, listener, options),
    invalid: [],
    channel: "userFills",
    payload: { type: "userFills", user: USER, aggregateByTime: true },
    match: { user: USER, fills: [], isSnapshot: true },
    misses: [{ user: OTHER_USER, fills: [] }],
  },
  {
    name: "userFundings",
    subscribe: (client, listener, options) => client.userFundings({ user: USER }, listener, options),
    invalid: [(client) => client.userFundings({ user: "0x123" } as never, () => {})],
    channel: "userFundings",
    payload: { type: "userFundings", user: USER },
    match: { user: USER, fundings: [] },
    misses: [{ user: OTHER_USER, fundings: [] }],
  },
  {
    name: "userHistoricalOrders",
    subscribe: (client, listener, options) => client.userHistoricalOrders({ user: USER }, listener, options),
    invalid: [(client) => client.userHistoricalOrders({ user: "0x123" } as never, () => {})],
    channel: "userHistoricalOrders",
    payload: { type: "userHistoricalOrders", user: USER },
    match: { user: USER, orderHistory: [] },
    misses: [{ user: OTHER_USER, orderHistory: [] }],
  },
  {
    name: "userNonFundingLedgerUpdates",
    subscribe: (client, listener, options) => client.userNonFundingLedgerUpdates({ user: USER }, listener, options),
    invalid: [(client) => client.userNonFundingLedgerUpdates({ user: "0x123" } as never, () => {})],
    channel: "userNonFundingLedgerUpdates",
    payload: { type: "userNonFundingLedgerUpdates", user: USER },
    match: { user: USER, nonFundingLedgerUpdates: [] },
    misses: [{ user: OTHER_USER, nonFundingLedgerUpdates: [] }],
  },
  {
    name: "userTwapHistory",
    subscribe: (client, listener, options) => client.userTwapHistory({ user: USER }, listener, options),
    invalid: [(client) => client.userTwapHistory({ user: "0x123" } as never, () => {})],
    channel: "userTwapHistory",
    payload: { type: "userTwapHistory", user: USER },
    match: { user: USER, history: [] },
    misses: [{ user: OTHER_USER, history: [] }],
  },
  {
    name: "userTwapSliceFills",
    subscribe: (client, listener, options) => client.userTwapSliceFills({ user: USER }, listener, options),
    invalid: [(client) => client.userTwapSliceFills({ user: "0x123" } as never, () => {})],
    channel: "userTwapSliceFills",
    payload: { type: "userTwapSliceFills", user: USER },
    match: { user: USER, twapSliceFills: [] },
    misses: [{ user: OTHER_USER, twapSliceFills: [] }],
  },
  {
    name: "webData3",
    subscribe: (client, listener, options) => client.webData3({ user: USER }, listener, options),
    invalid: [(client) => client.webData3({ user: "0x123" } as never, () => {})],
    channel: "webData3",
    payload: { type: "webData3", user: USER },
    match: { userState: { user: USER, abstraction: "dexAbstraction" }, perpDexStates: [] },
    misses: [{ userState: { user: OTHER_USER }, perpDexStates: [] }],
  },
];

// =============================================================
// Per-method coverage matrix
// =============================================================

describe("SubscriptionClient (offline mock transport)", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      test("subscribes once with the validated payload and forwards options", async () => {
        const transport = new MockSubscriptionTransport();
        const client = new SubscriptionClient({ transport });
        const options: SubscriptionOptions = { signal: AbortSignal.timeout(5_000), onError: () => {} };

        const sub = await c.subscribe(client, () => {}, options);

        expect(transport.calls).toHaveLength(1);
        const call = transport.calls[0];
        expect(call.channel).toBe(c.channel);
        expect(call.payload).toEqual(c.payload);
        expect(call.options).toBe(options);
        expect(typeof sub.unsubscribe).toBe("function");
        await sub.unsubscribe();
      });

      if (c.invalid.length > 0) {
        test("throws ValidationError on invalid params before any transport call", () => {
          const transport = new MockSubscriptionTransport();
          const client = new SubscriptionClient({ transport });

          for (const badCall of c.invalid) {
            expect(() => badCall(client)).toThrow(ValidationError);
          }
          expect(transport.calls).toHaveLength(0);
        });
      }

      test("delivers matching events and drops non-matching ones", async () => {
        const transport = new MockSubscriptionTransport();
        const client = new SubscriptionClient({ transport });
        const received: unknown[] = [];
        await c.subscribe(client, (data) => received.push(data));

        for (const miss of c.misses) transport.emit(miss);
        transport.emit(c.match);

        expect(received).toEqual([c.match]);
      });
    });
  }
});

// =============================================================
// Overloads and param normalization
// =============================================================

describe("listener-first overloads", () => {
  test("allMids subscribes with dex normalized to undefined and filters on it", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const options: SubscriptionOptions = { signal: AbortSignal.timeout(5_000) };
    const received: unknown[] = [];

    await client.allMids((data) => received.push(data), options);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].channel).toBe("allMids");
    expect(transport.calls[0].payload).toEqual({ type: "allMids", dex: undefined });
    expect(transport.calls[0].options).toBe(options);

    transport.emit({ mids: { ETH: "3000" } }); // no dex: matches `undefined`
    transport.emit({ mids: { ETH: "3000" }, dex: "unit" });
    expect(received).toEqual([{ mids: { ETH: "3000" } }]);
  });

  test("allMids normalizes an empty-string dex to undefined (`||`, not `??`)", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    await client.allMids({ dex: "" }, () => {});

    expect(transport.calls[0].payload).toEqual({ type: "allMids", dex: undefined });
  });

  test("assetCtxs subscribes with dex normalized to '' and filters on it", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const options: SubscriptionOptions = { signal: AbortSignal.timeout(5_000) };
    const received: unknown[] = [];

    await client.assetCtxs((data) => received.push(data), options);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].channel).toBe("assetCtxs");
    expect(transport.calls[0].payload).toEqual({ type: "assetCtxs", dex: "" });
    expect(transport.calls[0].options).toBe(options);

    transport.emit({ dex: "", ctxs: [] });
    transport.emit({ dex: "unit", ctxs: [] });
    expect(received).toEqual([{ dex: "", ctxs: [] }]);
  });

  test("assetCtxs preserves an explicit empty-string dex (`??`, not `||`)", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    await client.assetCtxs({ dex: "" }, () => {});

    expect(transport.calls[0].payload).toEqual({ type: "assetCtxs", dex: "" });
  });

  test("the exported free functions also accept listener-first calls", async () => {
    const transport = new MockSubscriptionTransport();

    await allMids({ transport }, () => {});
    await assetCtxs({ transport }, () => {});

    expect(transport.calls.map((call) => call.payload)).toEqual([
      { type: "allMids", dex: undefined },
      { type: "assetCtxs", dex: "" },
    ]);
  });
});

describe("param normalization", () => {
  test("an uppercase user address is lowercased by schema validation and used for filtering", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const received: unknown[] = [];

    await client.spotState({ user: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, (data) => received.push(data));

    expect(transport.calls[0].payload).toEqual({
      type: "spotState",
      user: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    transport.emit({ user: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", spotState: { balances: [] } });
    expect(received).toEqual([{ user: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", spotState: { balances: [] } }]);
  });
});

// =============================================================
// fastAssetCtxs (compressed frames)
// =============================================================

/** Compresses a JSON payload to base64 + raw DEFLATE (RFC 1951), the wire format of `fastAssetCtxs`. */
async function compressToBase64(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));

  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let result = await reader.read();
  while (!result.done) {
    chunks.push(result.value);
    result = await reader.read();
  }

  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  let binary = "";
  for (const byte of merged) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("fastAssetCtxs", () => {
  test("subscribes once with the validated payload and forwards options", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const options: SubscriptionOptions = { signal: AbortSignal.timeout(5_000), onError: () => {} };

    const sub = await client.fastAssetCtxs(() => {}, options);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].channel).toBe("fastAssetCtxs");
    expect(transport.calls[0].payload).toEqual({ type: "fastAssetCtxs" });
    expect(transport.calls[0].options).toBe(options);
    expect(typeof sub.unsubscribe).toBe("function");
    await sub.unsubscribe();
  });

  test("decompresses frames and delivers them to the listener in order", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const received: unknown[] = [];
    await client.fastAssetCtxs((data) => received.push(data));

    transport.emit(await compressToBase64({ ETH: { markPx: "3000", midPx: "3001" } }));
    transport.emit(await compressToBase64({ BTC: { markPx: "60000", midPx: null } }));
    await new Promise((resolve) => setTimeout(resolve, 10)); // let the sequential delivery queue drain

    expect(received).toEqual([{ ETH: { markPx: "3000", midPx: "3001" } }, { BTC: { markPx: "60000", midPx: null } }]);
  });

  test("an undecodable frame is logged and skipped without killing the queue", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const transport = new MockSubscriptionTransport();
      const client = new SubscriptionClient({ transport });
      const received: unknown[] = [];
      await client.fastAssetCtxs((data) => received.push(data));

      transport.emit("%%%not-base64%%%");
      transport.emit(await compressToBase64({ ETH: { markPx: "3000" } }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(received).toEqual([{ ETH: { markPx: "3000" } }]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("table-driven base64 path runs when Buffer is unavailable", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const received: unknown[] = [];
    await client.fastAssetCtxs((data) => received.push(data));

    const frame = await compressToBase64({ ETH: { markPx: "1" } });
    const originalBuffer = globalThis.Buffer;
    // Hide Buffer so decodeBase64 takes the pure-JS LUT path (browser / RN without a polyfill).
    delete (globalThis as { Buffer?: unknown }).Buffer;
    try {
      transport.emit(frame);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      globalThis.Buffer = originalBuffer;
    }
    expect(received).toEqual([{ ETH: { markPx: "1" } }]);
  });

  test("table-driven base64 rejects invalid alphabet and odd padding shapes", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const received: unknown[] = [];
    await client.fastAssetCtxs((data) => received.push(data));

    const originalBuffer = globalThis.Buffer;
    delete (globalThis as { Buffer?: unknown }).Buffer;
    try {
      // Valid length, invalid character → LUT miss (255).
      transport.emit("!!!!");
      // Empty / non-multiple-of-4 lengths.
      transport.emit("");
      transport.emit("abc");
      // One- and two-byte padding groups (still valid alphabet, table path).
      transport.emit("YQ=="); // "a"
      transport.emit(await compressToBase64({ OK: { markPx: "2" } }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Only the final valid compressed frame is delivered; bad frames are logged.
      expect(received).toEqual([{ OK: { markPx: "2" } }]);
      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      globalThis.Buffer = originalBuffer;
      errorSpy.mockRestore();
    }
  });

  test("multi-chunk inflate merges into the retained scratch buffer", async () => {
    const { _setForceStreamDecompressForTests } = await import(
      "../../../src/api/subscription/_methods/fastAssetCtxs.ts"
    );
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const received: unknown[] = [];
    await client.fastAssetCtxs((data) => received.push(data));

    const payload = new TextEncoder().encode(JSON.stringify({ BTC: { markPx: "100", midPx: "101" } }));
    // Force three stream chunks so the multi-chunk merge + while-loop arms all run.
    const parts = [payload.subarray(0, 4), payload.subarray(4, 10), payload.subarray(10)];

    const RealDS = globalThis.DecompressionStream;
    globalThis.DecompressionStream = class {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<BufferSource>;
      constructor(_format: CompressionFormat) {
        this.writable = new WritableStream({
          write() {},
          close() {},
        });
        let i = 0;
        this.readable = new ReadableStream({
          pull(controller) {
            if (i < parts.length) controller.enqueue(parts[i++]);
            else controller.close();
          },
        });
      }
    } as unknown as typeof DecompressionStream;

    _setForceStreamDecompressForTests(true);
    try {
      // Wire payload is unused by the fake inflater; any valid base64 string is fine.
      transport.emit("AAAA");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received).toEqual([{ BTC: { markPx: "100", midPx: "101" } }]);
    } finally {
      _setForceStreamDecompressForTests(false);
      globalThis.DecompressionStream = RealDS;
    }
  });

  test("stream write failures are absorbed without poisoning the queue", async () => {
    const { _setForceStreamDecompressForTests } = await import(
      "../../../src/api/subscription/_methods/fastAssetCtxs.ts"
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const received: unknown[] = [];
    await client.fastAssetCtxs((data) => received.push(data));

    const RealDS = globalThis.DecompressionStream;
    let rejectWrite = true;
    globalThis.DecompressionStream = class {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<BufferSource>;
      constructor(format: CompressionFormat) {
        if (!rejectWrite) {
          const real = new RealDS(format);
          this.readable = real.readable as ReadableStream<Uint8Array>;
          this.writable = real.writable;
          return;
        }
        this.writable = new WritableStream({
          write() {
            return Promise.reject(new Error("write failed"));
          },
          close() {},
        });
        // Reader still needs to settle so decompress can fail via empty/error read.
        this.readable = new ReadableStream({
          start(controller) {
            controller.error(new Error("inflate failed"));
          },
        });
      }
    } as unknown as typeof DecompressionStream;

    _setForceStreamDecompressForTests(true);
    try {
      transport.emit("AAAA");
      await new Promise((resolve) => setTimeout(resolve, 15));
      rejectWrite = false;
      transport.emit(await compressToBase64({ ETH: { markPx: "3" } }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received).toEqual([{ ETH: { markPx: "3" } }]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      _setForceStreamDecompressForTests(false);
      globalThis.DecompressionStream = RealDS;
      errorSpy.mockRestore();
    }
  });

  test("empty inflate stream is logged and does not poison the queue", async () => {
    const { _setForceStreamDecompressForTests } = await import(
      "../../../src/api/subscription/_methods/fastAssetCtxs.ts"
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });
    const received: unknown[] = [];
    await client.fastAssetCtxs((data) => received.push(data));

    const RealDS = globalThis.DecompressionStream;
    let useEmpty = true;
    globalThis.DecompressionStream = class {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<BufferSource>;
      constructor(format: CompressionFormat) {
        if (!useEmpty) {
          const real = new RealDS(format);
          this.readable = real.readable as ReadableStream<Uint8Array>;
          this.writable = real.writable;
          return;
        }
        this.writable = new WritableStream({
          write() {},
          close() {},
        });
        this.readable = new ReadableStream({
          start(controller) {
            controller.close(); // first read is immediately done
          },
        });
      }
    } as unknown as typeof DecompressionStream;

    _setForceStreamDecompressForTests(true);
    try {
      transport.emit("AAAA");
      await new Promise((resolve) => setTimeout(resolve, 15));
      useEmpty = false;
      transport.emit(await compressToBase64({ ETH: { markPx: "9" } }));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toEqual([{ ETH: { markPx: "9" } }]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      _setForceStreamDecompressForTests(false);
      globalThis.DecompressionStream = RealDS;
      errorSpy.mockRestore();
    }
  });
});
