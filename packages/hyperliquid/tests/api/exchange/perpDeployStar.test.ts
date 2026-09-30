import { expect, test } from "bun:test";
import { ExchangeClient } from "@bloxwap/hyperliquid";
import { perpDeploy, type PerpDeployParameters } from "@bloxwap/hyperliquid/api/exchange";
import { createL1ActionHash } from "@bloxwap/hyperliquid/signing";
import { encode } from "@jsr/std__msgpack";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { recordingTransport, singleWalletConfig, FIXED_NONCE, LIMIT_ORDER } from "./_mockTransport.ts";
const address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const proxies = [
  { modifyApproval: true },
  { modifyBackstopLiquidatorApproval: false },
  { setReduceOnly: true },
  { cancel: { cancels: [{ a: 100001, o: 123 }], f: true } },
  { cancelAll: {} },
  { cancelAll: { assets: null } },
  { cancelAll: { assets: [100001, 100002] } },
  { order: { orders: [{ ...LIMIT_ORDER, r: true }], grouping: "na" } },
  { sendAsset: { destination: address, amount: "100" } },
];
const registration = {
  maxGas: null,
  assetRequest: { coin: "test:BTC", szDecimals: 3, oraclePx: "100", marginTableId: 1, marginMode: "normal" },
  dex: "test",
  schema: { fullName: "Test", collateralToken: 0, oracleUpdater: null, isStar: true },
};
const operations = [
  { registerAsset2: registration },
  {
    registerAsset: {
      ...registration,
      assetRequest: { coin: "test:BTC", szDecimals: 3, oraclePx: "100", marginTableId: 1, onlyIsolated: false },
    },
  },
  {
    star: {
      dex: "test",
      operation: {
        setOracle: {
          oraclePxs: [
            ["test:BTC", "100"],
            ["test:ETH", "50"],
          ],
        },
      },
    },
  },
  ...proxies.map((proxy) => ({ star: { dex: "test", operation: { proxy: [address, proxy] } } })),
  {
    setSubDeployers: {
      dex: "test",
      subDeployers: [
        { variant: { hip3Star: "modifyApproval" }, user: address, allowed: true },
        { variant: "setOracle", user: address, allowed: false },
      ],
    },
  },
] as PerpDeployParameters[];
test("all star operations, registration and mixed grants have independent signing-byte parity", async () => {
  for (const operation of operations) {
    const { transport, calls } = recordingTransport();
    const config = singleWalletConfig(transport);
    await perpDeploy(config, operation);
    await new ExchangeClient(config).perpDeploy(operation);
    const expected = { type: "perpDeploy", ...operation };
    expect(calls[0].payload.action).toEqual(expected);
    expect(calls[0].payload).toEqual(calls[1].payload);
    const encoded = encode(expected as Parameters<typeof encode>[0]);
    const bytes = new Uint8Array(encoded.length + 9);
    bytes.set(encoded);
    new DataView(bytes.buffer).setBigUint64(encoded.length, BigInt(FIXED_NONCE));
    expect(createL1ActionHash({ action: calls[0].payload.action, nonce: FIXED_NONCE })).toBe(
      `0x${Buffer.from(keccak_256(bytes)).toString("hex")}`,
    );
  }
});
test("nested addresses normalize and cancel/order restrictions reject before signing", async () => {
  const { transport, calls } = recordingTransport();
  await perpDeploy(singleWalletConfig(transport), {
    star: {
      dex: "test",
      operation: {
        proxy: [
          address.toUpperCase().replace("0X", "0x") as `0x${string}`,
          { sendAsset: { destination: address.toUpperCase().replace("0X", "0x") as `0x${string}`, amount: "1" } },
        ],
      },
    },
  });
  expect(calls[0].payload.action).toEqual({
    type: "perpDeploy",
    star: { dex: "test", operation: { proxy: [address, { sendAsset: { destination: address, amount: "1" } }] } },
  });
  for (const proxy of [
    { cancelAll: { assets: [] } },
    { cancelAll: { assets: Array(11).fill(1) } },
    { order: { orders: [LIMIT_ORDER], grouping: "na" } },
  ]) {
    expect(() =>
      perpDeploy(singleWalletConfig(transport), {
        star: { dex: "test", operation: { proxy: [address, proxy] } },
      } as never),
    ).toThrow();
  }
  expect(calls).toHaveLength(1);
});
