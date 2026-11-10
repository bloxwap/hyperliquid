/**
 * Every user-signed EIP-712 types object lists its primary type first, and that type's first
 * field is `hyperliquidChain`. The `satisfies` lines below are the build-time half of the check.
 * @module
 */

import { expect, test } from "bun:test";
import * as exchange from "../../src/api/exchange/mod.ts";
import { HyperliquidError } from "../../src/_errors.ts";
import { MULTI_SIG_TYPES } from "../../src/signing/_multiSig.ts";
import { signUserSignedAction } from "../../src/signing/_userSigned.ts";
import type { UserSignedActionTypes } from "../../src/signing/_userSignedShape.ts";

interface Field {
  name: string;
  type: string;
}

function assertPrimaryFirst(label: string, types: Record<string, readonly Field[]>): void {
  const keys = Object.keys(types);
  expect(keys.length, label).toBeGreaterThan(0);
  expect(keys[0], label).toMatch(/^HyperliquidTransaction:/);
  expect(types[keys[0]]?.[0], label).toEqual({ name: "hyperliquidChain", type: "string" });
}

const _wrongFirstField: UserSignedActionTypes = {
  "HyperliquidTransaction:UsdSend": [
    // @ts-expect-error first field must be hyperliquidChain:string
    { name: "destination", type: "string" },
    { name: "hyperliquidChain", type: "string" },
  ],
};

const _domainFirst: UserSignedActionTypes = {
  // @ts-expect-error EIP712Domain is not a HyperliquidTransaction primary type
  EIP712Domain: [{ name: "name", type: "string" }],
  "HyperliquidTransaction:UsdSend": [
    { name: "hyperliquidChain", type: "string" },
    { name: "time", type: "uint64" },
  ],
};

test("every user-signed action type definition lists hyperliquidChain first", () => {
  const found: string[] = [];
  for (const [name, value] of Object.entries(exchange)) {
    if (!name.endsWith("Types")) continue;
    found.push(name);
    assertPrimaryFirst(name, value as Record<string, readonly Field[]>);
  }
  expect(found.length).toBeGreaterThanOrEqual(17);
  assertPrimaryFirst("MULTI_SIG_TYPES", MULTI_SIG_TYPES);
});

test("signUserSignedAction rejects types that put EIP712Domain ahead of the primary type", async () => {
  const usdSend = exchange.UsdSendTypes;
  await expect(
    signUserSignedAction({
      wallet: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async () => {
          throw new Error("should not sign");
        },
      },
      action: {
        signatureChainId: "0x1",
        hyperliquidChain: "Mainnet",
        destination: "0x2222222222222222222222222222222222222222",
        amount: "1",
        time: 1_800_000_000_000,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...usdSend,
      },
    }),
  ).rejects.toThrow(HyperliquidError);
  await expect(
    signUserSignedAction({
      wallet: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async () => {
          throw new Error("should not sign");
        },
      },
      action: {
        signatureChainId: "0x1",
        hyperliquidChain: "Mainnet",
        destination: "0x2222222222222222222222222222222222222222",
        amount: "1",
        time: 1_800_000_000_000,
      },
      types: {
        EIP712Domain: [{ name: "name", type: "string" }],
        ...usdSend,
      },
    }),
  ).rejects.toThrow(/hyperliquidChain/);
});
