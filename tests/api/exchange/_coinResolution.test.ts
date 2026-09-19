/**
 * Offline tests for symbol-based asset references (`coin`) on `ExchangeClient` order-ish methods:
 * symbols are resolved to raw asset IDs via a `SymbolConverter` over the client's transport before
 * dispatch, while raw asset IDs pass through without any metadata fetch.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import { ExchangeClient, HyperliquidError, type IRequestTransport } from "@bloxwap/hyperliquid";
import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
import {
  CLOID,
  FIXED_NONCE,
  LIMIT_ORDER,
  type RecordedRequest,
  singleWalletConfig,
  SUCCESS,
} from "./_mockTransport.ts";

// ============================================================
// Fixtures
// ============================================================

/** Perp meta: BTC → asset 0, ETH → asset 1. */
const META = {
  universe: [
    { name: "BTC", szDecimals: 5 },
    { name: "ETH", szDecimals: 4 },
  ],
  marginTables: [],
};

/** Spot meta: HYPE/USDC → asset 10107. */
const SPOT_META = {
  tokens: [
    { name: "HYPE", szDecimals: 2, index: 0 },
    { name: "USDC", szDecimals: 8, index: 1 },
  ],
  universe: [{ name: "@107", tokens: [0, 1], index: 107 }],
};

const OUTCOME_META = { questions: [], outcomes: [] };

/**
 * A transport that answers the three metadata requests `SymbolConverter.reload` makes and records
 * everything; exchange requests resolve with the generic {@linkcode SUCCESS} envelope.
 */
function metaTransport(): { calls: RecordedRequest[]; transport: IRequestTransport } {
  const calls: RecordedRequest[] = [];
  return {
    calls,
    transport: {
      isTestnet: true,
      request<T>(endpoint: "info" | "exchange", payload: unknown, signal?: AbortSignal): Promise<T> {
        calls.push({ endpoint, payload: payload as RecordedRequest["payload"], signal });
        if (endpoint === "info") {
          const type = (payload as { type: string }).type;
          if (type === "meta") return Promise.resolve(META as T);
          if (type === "spotMeta") return Promise.resolve(SPOT_META as T);
          if (type === "outcomeMeta") return Promise.resolve(OUTCOME_META as T);
          return Promise.reject(new Error(`unexpected info request type: ${type}`));
        }
        return Promise.resolve(SUCCESS as T);
      },
    },
  };
}

/** Counts requests by endpoint. */
function countByEndpoint(calls: RecordedRequest[]): { info: number; exchange: number } {
  return {
    info: calls.filter((c) => c.endpoint === "info").length,
    exchange: calls.filter((c) => c.endpoint === "exchange").length,
  };
}

const COIN_ORDER = { coin: "BTC", b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } } as const;

// ============================================================
// Tests
// ============================================================

describe("ExchangeClient coin resolution (offline)", () => {
  test("order: a coin symbol is resolved to its asset ID before dispatch", async () => {
    const { calls, transport } = metaTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.order({ orders: [COIN_ORDER], grouping: "na" });

    assertEquals(countByEndpoint(calls), { info: 3, exchange: 1 }); // meta + spotMeta + outcomeMeta, once
    assertEquals(calls.filter((c) => c.endpoint === "exchange")[0].payload.action, {
      type: "order",
      orders: [{ ...LIMIT_ORDER, a: 0 }],
      grouping: "na",
    });
  });

  test("order: a spot pair symbol resolves to 10000 + spot index", async () => {
    const { calls, transport } = metaTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.order({ orders: [{ ...COIN_ORDER, coin: "HYPE/USDC" }], grouping: "na" });

    const action = calls.filter((c) => c.endpoint === "exchange")[0].payload.action;
    assertEquals((action.orders as { a: number }[])[0].a, 10107);
  });

  test("order: entries without a coin pass through untouched, alongside resolved entries", async () => {
    const { calls, transport } = metaTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.order({ orders: [COIN_ORDER, { ...LIMIT_ORDER, a: 1 }], grouping: "na" });

    const action = calls.filter((c) => c.endpoint === "exchange")[0].payload.action;
    assertEquals(action.orders, [
      { ...LIMIT_ORDER, a: 0 },
      { ...LIMIT_ORDER, a: 1 },
    ]);
  });

  test("order: when both the raw asset ID and coin are set, coin wins", async () => {
    const { calls, transport } = metaTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.order({ orders: [{ ...COIN_ORDER, a: 1, coin: "BTC" }], grouping: "na" });

    const action = calls.filter((c) => c.endpoint === "exchange")[0].payload.action;
    assertEquals((action.orders as { a: number }[])[0].a, 0);
  });

  test("the lazily created converter is reused across calls", async () => {
    const { calls, transport } = metaTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.order({ orders: [COIN_ORDER], grouping: "na" });
    await client.cancel({ cancels: [{ coin: "ETH", o: 123 }] });

    assertEquals(countByEndpoint(calls), { info: 3, exchange: 2 });
    const cancelAction = calls.filter((c) => c.endpoint === "exchange")[1].payload.action;
    assertEquals(cancelAction, { type: "cancel", cancels: [{ a: 1, o: 123 }] });
  });

  test("a config-provided symbolConverter is used instead of creating one", async () => {
    const { calls, transport } = metaTransport();
    const symbolConverter = await SymbolConverter.create({ transport });
    assertEquals(countByEndpoint(calls).info, 3);
    const client = new ExchangeClient(singleWalletConfig(transport, { symbolConverter }));

    await client.order({ orders: [COIN_ORDER], grouping: "na" });

    assertEquals(countByEndpoint(calls), { info: 3, exchange: 1 }); // no refetch
  });

  test("raw asset IDs never trigger a metadata fetch", async () => {
    const { calls, transport } = metaTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await client.order({ orders: [LIMIT_ORDER], grouping: "na" });
    await client.cancel({ cancels: [{ a: 0, o: 123 }] });

    assertEquals(countByEndpoint(calls), { info: 0, exchange: 2 });
  });

  test("an unknown coin rejects with HyperliquidError before anything is sent", async () => {
    const { calls, transport } = metaTransport();
    const client = new ExchangeClient(singleWalletConfig(transport));

    await assertRejects(
      () => client.order({ orders: [{ ...COIN_ORDER, coin: "NOPE" }], grouping: "na" }),
      HyperliquidError,
      'Unknown coin: "NOPE"',
    );
    assertEquals(countByEndpoint(calls).exchange, 0);
  });

  // Every order-ish method resolves `coin` into the same wire action as the raw asset ID.
  const COIN_CASES: {
    name: string;
    run: (client: ExchangeClient) => Promise<unknown>;
    action: Record<string, unknown>;
  }[] = [
    {
      name: "modify",
      run: (c) => c.modify({ oid: 123, order: COIN_ORDER }),
      action: { type: "modify", oid: 123, order: { ...LIMIT_ORDER, a: 0 } },
    },
    {
      name: "batchModify",
      run: (c) => c.batchModify({ modifies: [{ oid: 123, order: COIN_ORDER }] }),
      action: { type: "batchModify", modifies: [{ oid: 123, order: { ...LIMIT_ORDER, a: 0 } }] },
    },
    {
      name: "cancel",
      run: (c) => c.cancel({ cancels: [{ coin: "ETH", o: 123 }] }),
      action: { type: "cancel", cancels: [{ a: 1, o: 123 }] },
    },
    {
      name: "cancelByCloid",
      run: (c) => c.cancelByCloid({ cancels: [{ coin: "ETH", cloid: CLOID }] }),
      action: { type: "cancelByCloid", cancels: [{ asset: 1, cloid: CLOID }] },
    },
    {
      name: "twapOrder",
      run: (c) => c.twapOrder({ twap: { coin: "BTC", b: true, s: "0.1", r: false, m: 5, t: false } }),
      action: { type: "twapOrder", twap: { a: 0, b: true, s: "0.1", r: false, m: 5, t: false } },
    },
    {
      name: "twapCancel",
      run: (c) => c.twapCancel({ coin: "BTC", t: 1 }),
      action: { type: "twapCancel", a: 0, t: 1 },
    },
    {
      name: "updateLeverage",
      run: (c) => c.updateLeverage({ coin: "BTC", isCross: true, leverage: 5 }),
      action: { type: "updateLeverage", asset: 0, isCross: true, leverage: 5 },
    },
    {
      name: "updateIsolatedMargin",
      run: (c) => c.updateIsolatedMargin({ coin: "BTC", isBuy: true, ntli: 1_000_000 }),
      action: { type: "updateIsolatedMargin", asset: 0, isBuy: true, ntli: 1_000_000 },
    },
    {
      name: "topUpIsolatedOnlyMargin",
      run: (c) => c.topUpIsolatedOnlyMargin({ coin: "BTC", leverage: "0.5" }),
      action: { type: "topUpIsolatedOnlyMargin", asset: 0, leverage: "0.5" },
    },
  ];

  for (const { name, run, action } of COIN_CASES) {
    test(`${name}: coin resolves to the same wire action as the raw asset ID`, async () => {
      const { calls, transport } = metaTransport();
      const client = new ExchangeClient(singleWalletConfig(transport));

      await run(client);

      const exchangeCalls = calls.filter((c) => c.endpoint === "exchange");
      assertEquals(exchangeCalls.length, 1);
      assertEquals(exchangeCalls[0].payload.action, action);
      assertEquals(exchangeCalls[0].payload.nonce, FIXED_NONCE);
    });
  }
});
