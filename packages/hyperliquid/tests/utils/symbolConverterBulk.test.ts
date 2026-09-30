import { expect, test } from "bun:test";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { SymbolConverter } from "@bloxwap/hyperliquid/utils";
import type { MetaResponse } from "@bloxwap/hyperliquid/api/info";
function metadata(...names: string[]): MetaResponse {
  return {
    universe: names.map((name) => ({ name, szDecimals: 3, maxLeverage: 20, marginTableId: 1 })),
    marginTables: [],
    collateralToken: 0,
  };
}
const registry = [null, { name: "foo" }, null, { name: "" }, { name: "bar" }];
const metas = [metadata("BTC"), metadata("foo:A"), metadata(), metadata(), metadata("bar:A", "bar:B")];
function backend(
  dexs: unknown[] = registry,
  all: unknown = metas,
): {
  transport: IRequestTransport;
  calls: { type: string; dex?: string }[];
  data: { registry: unknown[]; metas: unknown; failure?: Error; gate?: Promise<unknown> };
} {
  const calls: { type: string; dex?: string }[] = [];
  const data = { registry: dexs, metas: all } as {
    registry: unknown[];
    metas: unknown;
    failure?: Error;
    gate?: Promise<unknown>;
  };
  const transport: IRequestTransport = {
    isTestnet: false,
    request: async <T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> => {
      const request = payload as { type: string; dex?: string };
      calls.push(request);
      const results: Record<string, unknown> = {
        allPerpMetas: data.metas,
        meta: request.dex ? metas.find((meta) => meta.universe[0]?.name.startsWith(`${request.dex}:`)) : metas[0],
        perpDexs: data.registry,
        spotMeta: {
          tokens: [
            { index: 0, name: "USDC", szDecimals: 8 },
            { index: 1, name: "FOO", szDecimals: 2 },
          ],
          universe: [{ index: 3, name: "@3", tokens: [1, 0] }],
        },
        outcomeMeta: {
          outcomes: [
            {
              outcome: 3,
              name: "Election",
              description: "",
              sideSpecs: [{ name: "Yes" }, { name: "No" }],
              quoteToken: "USDC",
            },
          ],
          questions: [],
        },
      };
      if (request.type === "allPerpMetas") {
        if (data.failure) throw data.failure;
        if (data.gate) return (await data.gate) as T;
      }
      return results[request.type] as T;
    },
  };
  return { transport, calls, data };
}
test("bulk loading uses four requests and preserves sparse registry indices, spot/outcome and tick lookups", async () => {
  const { transport, calls } = backend();
  const converter = await SymbolConverter.create({ transport, dexs: true });
  expect(calls.map((x) => x.type).sort()).toEqual(["allPerpMetas", "outcomeMeta", "perpDexs", "spotMeta"]);
  expect(converter.getAssetId("BTC")).toBe(0);
  expect(converter.getAssetId("foo:A")).toBe(110000);
  expect(converter.getAssetId("bar:A")).toBe(140000);
  expect(converter.getAssetId("bar:B")).toBe(140001);
  expect(converter.getAssetId("FOO/USDC")).toBe(10003);
  expect(converter.getSpotPairId("FOO/USDC")).toBe("@3");
  expect(converter.getAssetId("election-yes")).toBe(100000030);
  expect(converter.getAssetId("election-no")).toBe(100000031);
  expect(converter.getSzDecimals("foo:A")).toBe(3);
  expect(converter.getTickSize("foo:A", "100")).toBe("0.01");
});
test("10 and 267 builder venues still require only four parallel requests", async () => {
  for (const count of [10, 267]) {
    const dexes = [null, ...Array.from({ length: count }, (_, i) => ({ name: `dex${i}` }))];
    const all = [metadata("BTC"), ...dexes.slice(1).map((dex) => metadata(`${dex!.name}:A`))];
    const { transport, calls } = backend(dexes, all);
    const converter = await SymbolConverter.create({ transport, dexs: true });
    expect(calls).toHaveLength(4);
    expect(converter.getAssetId(`dex${count - 1}:A`)).toBe(100000 + count * 10000);
  }
});
test("bulk reloads deduplicate and publish only after the entire replacement is ready", async () => {
  const { transport, calls, data } = backend();
  const converter = await SymbolConverter.create({ transport, dexs: true });
  const gate = Promise.withResolvers<unknown>();
  data.gate = gate.promise;
  const first = converter.reload();
  expect(converter.reload()).toBe(first);
  expect(converter.getAssetId("BTC")).toBe(0);
  expect(converter.getAssetId("foo:A")).toBe(110000);
  const replacement = [metadata("ETH"), metadata("foo:X"), ...metas.slice(2)];
  gate.resolve(replacement);
  await first;
  expect(calls.filter((x) => x.type === "allPerpMetas")).toHaveLength(2);
  expect(converter.getAssetId("BTC")).toBeUndefined();
  expect(converter.getAssetId("ETH")).toBe(0);
  expect(converter.getAssetId("foo:A")).toBeUndefined();
  expect(converter.getAssetId("foo:X")).toBe(110000);
});
test("bulk failures and mismatched arrays/prefixes preserve the previous snapshot without per-DEX fallback", async () => {
  const { transport, calls, data } = backend();
  const converter = await SymbolConverter.create({ transport, dexs: true });
  for (const wrong of [
    undefined,
    null,
    metas.slice(0, 4),
    metas.map((meta) => [meta, []]),
    [metadata("foo:wrong"), ...metas.slice(1)],
    [metas[0], metadata("bar:wrong"), ...metas.slice(2)],
  ]) {
    data.metas = wrong;
    await expect(converter.reload()).rejects.toThrow("SymbolConverter:");
    expect(converter.getAssetId("BTC")).toBe(0);
    expect(converter.getAssetId("foo:A")).toBe(110000);
  }
  data.failure = new Error("bulk unavailable");
  await expect(converter.reload()).rejects.toThrow("bulk unavailable");
  expect(converter.getAssetId("bar:B")).toBe(140001);
  expect(calls.some((x) => x.type === "meta")).toBe(false);
  data.failure = undefined;
  data.metas = metas;
  await converter.reload();
  expect(converter.getAssetId("bar:B")).toBe(140001);
});
test("selected and no-DEX modes retain narrow metadata requests", async () => {
  for (const option of [false, [], ["foo"], ["missing"]]) {
    const { transport, calls } = backend();
    const converter = await SymbolConverter.create({ transport, dexs: option });
    expect(calls.some((x) => x.type === "allPerpMetas")).toBe(false);
    const selected = Array.isArray(option) && option.includes("foo");
    expect(calls.filter((x) => x.dex !== undefined).map((x) => x.dex)).toEqual(selected ? ["foo"] : []);
    expect(converter.getAssetId("foo:A")).toBe(selected ? 110000 : undefined);
    expect(converter.getAssetId("bar:A")).toBeUndefined();
  }
});

const snapshots = [
  {
    network: "mainnet",
    registry: [
      null,
      {
        name: "xyz",
      },
      {
        name: "flx",
      },
    ],
    metas: [
      {
        universe: [
          {
            szDecimals: 5,
            name: "BTC",
            maxLeverage: 40,
            marginTableId: 56,
          },
          {
            szDecimals: 4,
            name: "ETH",
            maxLeverage: 25,
            marginTableId: 55,
          },
        ],
        marginTables: [
          [
            50,
            {
              description: "",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 50,
                },
              ],
            },
          ],
          [
            51,
            {
              description: "tiered 10x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 10,
                },
                {
                  lowerBound: "3000000.0",
                  maxLeverage: 5,
                },
              ],
            },
          ],
          [
            52,
            {
              description: "tiered 10x (2)",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 10,
                },
                {
                  lowerBound: "20000000.0",
                  maxLeverage: 5,
                },
              ],
            },
          ],
          [
            53,
            {
              description: "tiered 20x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 20,
                },
                {
                  lowerBound: "40000000.0",
                  maxLeverage: 10,
                },
              ],
            },
          ],
          [
            54,
            {
              description: "tiered 20x (2)",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 20,
                },
                {
                  lowerBound: "70000000.0",
                  maxLeverage: 10,
                },
              ],
            },
          ],
          [
            55,
            {
              description: "tiered 25x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 25,
                },
                {
                  lowerBound: "100000000.0",
                  maxLeverage: 15,
                },
              ],
            },
          ],
          [
            56,
            {
              description: "tiered 40x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 40,
                },
                {
                  lowerBound: "150000000.0",
                  maxLeverage: 20,
                },
              ],
            },
          ],
        ],
        collateralToken: 0,
      },
      {
        universe: [
          {
            szDecimals: 4,
            name: "xyz:XYZ100",
            maxLeverage: 30,
            marginTableId: 30,
            growthMode: "enabled",
            lastFeeScaleChangeTime: "2025-11-23T17:37:10.033211662",
            deployerFeeScale: "1.0",
          },
          {
            szDecimals: 3,
            name: "xyz:TSLA",
            maxLeverage: 20,
            marginTableId: 20,
            growthMode: "enabled",
            lastFeeScaleChangeTime: "2025-11-23T17:37:10.033211662",
            deployerFeeScale: "1.0",
          },
        ],
        marginTables: [
          [
            50,
            {
              description: "",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 50,
                },
              ],
            },
          ],
        ],
        collateralToken: 0,
      },
      {
        universe: [
          {
            szDecimals: 2,
            name: "flx:TSLA",
            maxLeverage: 10,
            marginTableId: 10,
            isDelisted: true,
            growthMode: "enabled",
            lastFeeScaleChangeTime: "2025-11-24T21:19:25.980742012",
            deployerFeeScale: "1.0",
          },
          {
            szDecimals: 2,
            name: "flx:NVDA",
            maxLeverage: 10,
            marginTableId: 10,
            isDelisted: true,
            growthMode: "enabled",
            lastFeeScaleChangeTime: "2026-03-08T03:42:24.011287219",
            deployerFeeScale: "1.0",
          },
        ],
        marginTables: [
          [
            50,
            {
              description: "",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 50,
                },
              ],
            },
          ],
          [
            51,
            {
              description: "5x leverage for small positions, 3x for large positions (>$1M)",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 5,
                },
                {
                  lowerBound: "1000000.0",
                  maxLeverage: 3,
                },
              ],
            },
          ],
          [
            52,
            {
              description: "3x leverage for small positions, 2x for large positions (>$1M)",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 3,
                },
                {
                  lowerBound: "1000000.0",
                  maxLeverage: 2,
                },
              ],
            },
          ],
          [
            53,
            {
              description: "10x/5x/3x leverage tiers based on position size",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 10,
                },
                {
                  lowerBound: "500000.0",
                  maxLeverage: 5,
                },
                {
                  lowerBound: "2000000.0",
                  maxLeverage: 3,
                },
              ],
            },
          ],
          [
            54,
            {
              description: "20x/15x/10x leverage tiers based on position size",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 20,
                },
                {
                  lowerBound: "1000000.0",
                  maxLeverage: 15,
                },
                {
                  lowerBound: "2000000.0",
                  maxLeverage: 10,
                },
              ],
            },
          ],
          [
            55,
            {
              description: "20x/10x leverage tiers based on position size",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 20,
                },
                {
                  lowerBound: "5000000.0",
                  maxLeverage: 10,
                },
              ],
            },
          ],
        ],
        collateralToken: 360,
      },
    ],
  },
  {
    network: "testnet",
    registry: [
      null,
      {
        name: "test",
      },
      {
        name: "unit",
      },
    ],
    metas: [
      {
        universe: [
          {
            szDecimals: 2,
            name: "SOL",
            maxLeverage: 10,
            marginTableId: 10,
          },
          {
            szDecimals: 2,
            name: "APT",
            maxLeverage: 3,
            marginTableId: 3,
          },
        ],
        marginTables: [
          [
            50,
            {
              description: "",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 50,
                },
              ],
            },
          ],
          [
            51,
            {
              description: "test 50x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 50,
                },
                {
                  lowerBound: "10000.0",
                  maxLeverage: 20,
                },
                {
                  lowerBound: "100000.0",
                  maxLeverage: 5,
                },
              ],
            },
          ],
          [
            52,
            {
              description: "tiered 10x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 10,
                },
                {
                  lowerBound: "20000.0",
                  maxLeverage: 5,
                },
                {
                  lowerBound: "100000.0",
                  maxLeverage: 3,
                },
              ],
            },
          ],
          [
            53,
            {
              description: "tiered 25x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 25,
                },
                {
                  lowerBound: "20000.0",
                  maxLeverage: 10,
                },
                {
                  lowerBound: "50000.0",
                  maxLeverage: 5,
                },
              ],
            },
          ],
          [
            54,
            {
              description: "tiered 40x",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 40,
                },
                {
                  lowerBound: "10000.0",
                  maxLeverage: 25,
                },
                {
                  lowerBound: "50000.0",
                  maxLeverage: 10,
                },
              ],
            },
          ],
          [
            55,
            {
              description: "tiered 10x (2)",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 10,
                },
                {
                  lowerBound: "10000.0",
                  maxLeverage: 5,
                },
              ],
            },
          ],
        ],
        collateralToken: 0,
      },
      {
        universe: [
          {
            szDecimals: 0,
            name: "test:ABC",
            maxLeverage: 3,
            marginTableId: 3,
            lastFeeScaleChangeTime: "1970-01-01T00:00:00",
            deployerFeeScale: "1.0",
          },
        ],
        marginTables: [
          [
            50,
            {
              description: "",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 50,
                },
              ],
            },
          ],
        ],
        collateralToken: 0,
      },
      {
        universe: [
          {
            szDecimals: 2,
            name: "unit:ES",
            maxLeverage: 20,
            marginTableId: 20,
            onlyIsolated: true,
            marginMode: "strictIsolated",
            lastFeeScaleChangeTime: "1970-01-01T00:00:00",
            deployerFeeScale: "1.0",
          },
          {
            szDecimals: 2,
            name: "unit:NQ",
            maxLeverage: 20,
            marginTableId: 20,
            onlyIsolated: true,
            isDelisted: true,
            marginMode: "strictIsolated",
            lastFeeScaleChangeTime: "1970-01-01T00:00:00",
            deployerFeeScale: "1.0",
          },
        ],
        marginTables: [
          [
            50,
            {
              description: "",
              marginTiers: [
                {
                  lowerBound: "0.0",
                  maxLeverage: 50,
                },
              ],
            },
          ],
        ],
        collateralToken: 0,
      },
    ],
  },
];
test("captured mainnet/testnet bulk metadata is plain objects aligned with registry indices", async () => {
  for (const snapshot of snapshots) {
    const { transport, calls } = backend(snapshot.registry, snapshot.metas);
    const converter = await SymbolConverter.create({ transport, dexs: true });
    expect(calls).toHaveLength(4);
    snapshot.metas.forEach((meta, index) => {
      meta.universe.forEach((asset, assetIndex) => {
        expect(converter.getAssetId(asset.name)).toBe(index === 0 ? assetIndex : 100000 + index * 10000 + assetIndex);
      });
    });
  }
});
