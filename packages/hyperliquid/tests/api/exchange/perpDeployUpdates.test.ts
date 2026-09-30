import { expect, test } from "bun:test";
import { ExchangeClient } from "@bloxwap/hyperliquid";
import { perpDeploy, type PerpDeployParameters } from "@bloxwap/hyperliquid/api/exchange";
import { createL1ActionHash } from "@bloxwap/hyperliquid/signing";
import { encode } from "@jsr/std__msgpack";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { recordingTransport, singleWalletConfig, FIXED_NONCE } from "./_mockTransport.ts";
const operations: PerpDeployParameters[] = [
  {
    setFundingClamps: [
      ["xyz:A", "0"],
      ["xyz:B", "0.01"],
    ],
  },
  {
    setDeployerFees: [
      ["xyz:A", { scale: "3", growthMode: false }],
      ["xyz:B", { scale: "9.99", growthMode: true }],
    ],
  },
  {
    setOpenInterestCaps: [
      ["xyz:A", null],
      ["xyz:B", 1000000],
    ],
  },
  { setMarginModes: [["xyz:A", "normal"]] },
];
test("HIP-3 setters preserve tuple order, fields and independent msgpack/hash parity", async () => {
  for (const operation of operations) {
    const { transport, calls } = recordingTransport();
    const config = singleWalletConfig(transport);
    await perpDeploy(config, operation);
    await new ExchangeClient(config).perpDeploy(operation);
    const expected = { type: "perpDeploy", ...operation };
    expect(calls[0].payload.action).toEqual(expected);
    expect(calls[0].payload).toEqual(calls[1].payload);
    const encoded = encode(expected as Parameters<typeof encode>[0]);
    const wire = new Uint8Array(encoded.length + 9);
    wire.set(encoded);
    new DataView(wire.buffer).setBigUint64(encoded.length, BigInt(FIXED_NONCE));
    expect(createL1ActionHash({ action: calls[0].payload.action, nonce: FIXED_NONCE })).toBe(
      `0x${Buffer.from(keccak_256(wire)).toString("hex")}`,
    );
  }
});
test("clamp/fee ranges reject invalid inputs before any transport call", async () => {
  for (const operation of [
    ...["-0.001", "0.0101"].map((clamp) => ({ setFundingClamps: [["xyz:A", clamp]] })),
    ...[
      { scale: "-1", growthMode: false },
      { scale: "3.01", growthMode: false },
      { scale: "10", growthMode: true },
    ].map((fee) => ({ setDeployerFees: [["xyz:A", fee]] })),
  ]) {
    const { transport, calls } = recordingTransport();
    await expect(async () => perpDeploy(singleWalletConfig(transport), operation as never)).toThrow();
    expect(calls).toHaveLength(0);
  }
});
