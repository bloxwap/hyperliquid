/**
 * Regression test for ISSUE #12: a `SymbolConverter.reload()` must never expose a torn cache.
 *
 * The reload used to clear all lookup maps up front and only repopulate the builder-dex entries
 * after a network fetch, so a concurrent reader could observe entries missing mid-reload. The fix
 * builds the replacement maps privately and publishes them in one synchronous block; this test
 * parks a reload on a gated builder-dex fetch and asserts readers still see the old snapshot.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertRejects, assertStrictEquals } from "@jsr/std__assert";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import type {
  MetaResponse,
  OutcomeMetaResponse,
  PerpDexsResponse,
  SpotMetaResponse,
} from "@bloxwap/hyperliquid/api/info";
import { SymbolConverter } from "@bloxwap/hyperliquid/utils";

// ============================================================
// Test Data
// ============================================================

const PERP_META: MetaResponse = {
  universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40, marginTableId: 1 }],
  marginTables: [],
  collateralToken: 6,
};

const SPOT_META: SpotMetaResponse = {
  tokens: [
    {
      name: "USDC",
      szDecimals: 8,
      weiDecimals: 8,
      index: 0,
      tokenId: "0x00000000000000000000000000000000",
      isCanonical: true,
      evmContract: null,
      fullName: null,
      deployerTradingFeeShare: "0",
    },
    {
      name: "PURR",
      szDecimals: 0,
      weiDecimals: 0,
      index: 1,
      tokenId: "0x00000000000000000000000000000001",
      isCanonical: true,
      evmContract: null,
      fullName: null,
      deployerTradingFeeShare: "0",
    },
  ],
  universe: [{ tokens: [1, 0], name: "@1", index: 0, isCanonical: true }],
};

const PERP_DEXS: PerpDexsResponse = [
  null,
  {
    name: "test",
    fullName: "Test Dex",
    deployer: "0x0000000000000000000000000000000000000000",
    oracleUpdater: null,
    feeRecipient: null,
    assetToStreamingOiCap: [],
    subDeployers: [],
    deployerFeeScale: "0",
    lastDeployerFeeScaleChangeTime: "2025-01-01T00:00:00",
    assetToFundingMultiplier: [],
    assetToFundingInterestRate: [],
  },
];

/** Builder-dex metadata: dex index 1 yields offset 110000, so "test:ABC" maps to asset id 110000. */
const DEX_META: MetaResponse = {
  universe: [{ name: "test:ABC", szDecimals: 0, maxLeverage: 3, marginTableId: 1 }],
  marginTables: [],
  collateralToken: 0,
};

const EMPTY_OUTCOME_META: OutcomeMetaResponse = { outcomes: [], questions: [] };

// ============================================================
// Helpers
// ============================================================

/** A promise with an exposed `resolve`, used to park the builder-dex fetch mid-reload. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** Creates a pending promise whose resolution the test controls. */
function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Builds a transport stub that serves static metadata, except builder-dex `meta({ dex })` requests,
 * which stay pending until the test resolves them — this is what parks `reload()` mid-flight.
 */
function createGatedTransport(): { transport: IRequestTransport; pendingDexRequests: Deferred<MetaResponse>[] } {
  const pendingDexRequests: Deferred<MetaResponse>[] = [];
  const responses: Record<string, unknown> = {
    meta: PERP_META,
    spotMeta: SPOT_META,
    perpDexs: PERP_DEXS,
    outcomeMeta: EMPTY_OUTCOME_META,
  };
  const transport: IRequestTransport = {
    isTestnet: false,
    request<T>(_endpoint: "info" | "exchange" | "explorer", payload: unknown): Promise<T> {
      const { type, dex } = payload as { type: string; dex?: string };
      if (type === "meta" && dex !== undefined) {
        const deferred = createDeferred<MetaResponse>();
        pendingDexRequests.push(deferred);
        return deferred.promise as Promise<T>;
      }
      return Promise.resolve(responses[type] as T);
    },
  };
  return { transport, pendingDexRequests };
}

/**
 * Waits until the gated transport has received the builder-dex fetch, which guarantees the
 * in-flight reload is parked exactly on that fetch: every other metadata request has settled.
 */
async function waitForDexRequest(pendingDexRequests: Deferred<MetaResponse>[], count: number): Promise<void> {
  for (let i = 0; i < 100 && pendingDexRequests.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assertEquals(pendingDexRequests.length, count);
}

/**
 * Builds a transport stub that counts requests per info `type` and can fail the next `meta`
 * request on demand, so a test can observe how many fetch rounds each reload actually ran.
 * Builder-dex support stays disabled, so a round is exactly one `meta`/`spotMeta`/`outcomeMeta`.
 */
function createCountingTransport(): {
  transport: IRequestTransport;
  requestCounts: Map<string, number>;
  failMetaRequest: { current: boolean };
} {
  const requestCounts = new Map<string, number>();
  const failMetaRequest = { current: false };
  const responses: Record<string, unknown> = {
    meta: PERP_META,
    spotMeta: SPOT_META,
    outcomeMeta: EMPTY_OUTCOME_META,
  };
  const transport: IRequestTransport = {
    isTestnet: false,
    request<T>(_endpoint: "info" | "exchange" | "explorer", payload: unknown): Promise<T> {
      const { type } = payload as { type: string };
      requestCounts.set(type, (requestCounts.get(type) ?? 0) + 1);
      if (type === "meta" && failMetaRequest.current) {
        failMetaRequest.current = false;
        return Promise.reject(new Error("simulated transport failure"));
      }
      return Promise.resolve(responses[type] as T);
    },
  };
  return { transport, requestCounts, failMetaRequest };
}

// ============================================================
// Tests
// ============================================================

describe("SymbolConverter reload() consistency", () => {
  test("readers never observe a torn cache while a reload is in flight", async () => {
    const { transport, pendingDexRequests } = createGatedTransport();

    // Populate the converter fully: resolve the creation-time dex fetch.
    const createPromise = SymbolConverter.create({ transport, dexs: ["test"] });
    await waitForDexRequest(pendingDexRequests, 1);
    pendingDexRequests[0].resolve(DEX_META);
    const converter = await createPromise;

    // Snapshot of the published cache before the second reload starts.
    const before = {
      dexAssetId: converter.getAssetId("test:ABC"),
      dexSzDecimals: converter.getSzDecimals("test:ABC"),
      perpAssetId: converter.getAssetId("BTC"),
      spotAssetId: converter.getAssetId("PURR/USDC"),
      spotPairId: converter.getSpotPairId("PURR/USDC"),
      spotSymbol: converter.getSymbolBySpotPairId("@1"),
    };
    assertEquals(before.dexAssetId, 110000);

    // Kick off a reload without awaiting it and let it park on the gated builder-dex fetch.
    const reloadPromise = converter.reload();
    await waitForDexRequest(pendingDexRequests, 2);

    // Mid-reload, readers must still observe the complete previous snapshot.
    assertEquals(converter.getAssetId("test:ABC"), before.dexAssetId);
    assertEquals(converter.getSzDecimals("test:ABC"), before.dexSzDecimals);
    assertEquals(converter.getAssetId("BTC"), before.perpAssetId);
    assertEquals(converter.getAssetId("PURR/USDC"), before.spotAssetId);
    assertEquals(converter.getSpotPairId("PURR/USDC"), before.spotPairId);
    assertEquals(converter.getSymbolBySpotPairId("@1"), before.spotSymbol);

    // Unblock the dex fetch; once the reload settles the published values must be intact.
    pendingDexRequests[1].resolve(DEX_META);
    await reloadPromise;

    assertEquals(converter.getAssetId("test:ABC"), before.dexAssetId);
    assertEquals(converter.getSzDecimals("test:ABC"), before.dexSzDecimals);
    assertEquals(converter.getAssetId("BTC"), before.perpAssetId);
    assertEquals(converter.getAssetId("PURR/USDC"), before.spotAssetId);
    assertEquals(converter.getSpotPairId("PURR/USDC"), before.spotPairId);
    assertEquals(converter.getSymbolBySpotPairId("@1"), before.spotSymbol);
  });
});

describe("SymbolConverter reload() dedup", () => {
  test("concurrent reload() calls share one in-flight reload", async () => {
    const { transport, requestCounts } = createCountingTransport();
    // One fetch round for creation: meta/spotMeta/outcomeMeta are each requested once.
    const converter = await SymbolConverter.create({ transport });

    const first = converter.reload();
    const second = converter.reload();
    const third = converter.reload();

    // Concurrent callers receive the same in-flight promise...
    assertStrictEquals(second, first);
    assertStrictEquals(third, first);
    await Promise.all([first, second, third]);

    // ...so only one additional fetch round ran: each info request was made exactly twice in total.
    assertEquals(requestCounts.get("meta"), 2);
    assertEquals(requestCounts.get("spotMeta"), 2);
    assertEquals(requestCounts.get("outcomeMeta"), 2);
  });

  test("a reload started after the previous one settles issues a fresh fetch round", async () => {
    const { transport, requestCounts } = createCountingTransport();
    const converter = await SymbolConverter.create({ transport });

    await converter.reload();
    await converter.reload();

    // The dedup window closes when the in-flight reload settles: create + two sequential reloads.
    assertEquals(requestCounts.get("meta"), 3);
    assertEquals(requestCounts.get("spotMeta"), 3);
    assertEquals(requestCounts.get("outcomeMeta"), 3);
  });

  test("a rejected reload clears the in-flight slot so the next reload retries", async () => {
    const { transport, requestCounts, failMetaRequest } = createCountingTransport();
    const converter = await SymbolConverter.create({ transport });

    failMetaRequest.current = true;
    await assertRejects(() => converter.reload(), Error, "simulated transport failure");

    // The rejection must not poison the converter: a subsequent reload issues a fresh fetch round,
    // and the previously published snapshot survives the failed attempt.
    assertEquals(converter.getAssetId("BTC"), 0);
    await converter.reload();

    assertEquals(converter.getAssetId("BTC"), 0);
    assertEquals(requestCounts.get("meta"), 3); // create + failed attempt + successful retry
  });
});
