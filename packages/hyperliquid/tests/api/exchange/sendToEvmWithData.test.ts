import {
  type SendToEvmWithDataParameters,
  SendToEvmWithDataRequest,
  sendToEvmWithData,
} from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { ValidationError } from "@bloxwap/hyperliquid";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest, topUpSpot } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/sendToEvmWithData.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "SendToEvmWithDataSuccessResponse");
const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(SendToEvmWithDataRequest.entries.action.entries), [
    "type",
    "signatureChainId",
    "hyperliquidChain",
    "nonce",
  ]),
);

runTest({
  name: "sendToEvmWithData",
  skipMultiSig: true, // API does not support multi-sig for this action (maybe)
  codeTestFn: async (_t, exchClient) => {
    await topUpSpot(exchClient, "USDC", "2");

    const params: SendToEvmWithDataParameters[] = [
      {
        token: "USDC",
        amount: "1",
        sourceDex: "spot",
        destinationRecipient: "0x0000000000000000000000000000000000000001",
        addressEncoding: "hex",
        destinationChainId: 998,
        gasLimit: 200000,
        data: "0x",
      },
    ];

    const data = await Promise.all(params.map((p) => exchClient.sendToEvmWithData(p)));

    schemaCoverage(paramsSchema, params, [
      "#/properties/addressEncoding/enum/1", // "base58" — only testing "hex"
    ]);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: `data` must be even-length, lowercase-"0x"-prefixed hex (EIP-712 `bytes`)
// ============================================================

const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

const BASE_PARAMS = {
  token: "USDC",
  amount: "1",
  sourceDex: "spot",
  destinationRecipient: "0x0000000000000000000000000000000000000001",
  addressEncoding: "hex",
  destinationChainId: 998,
  gasLimit: 200000,
} as const;

/** Creates a transport stub that records posted payloads and resolves with a success response. */
function recordingTransport(): { transport: IRequestTransport; payloads: { action: Record<string, unknown> }[] } {
  const payloads: { action: Record<string, unknown> }[] = [];
  const transport: IRequestTransport = {
    isTestnet: true,
    request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
      payloads.push(payload as { action: Record<string, unknown> });
      return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
    },
  };
  return { transport, payloads };
}

describe("sendToEvmWithData (offline)", () => {
  test("rejects odd-length hex data", () => {
    const { transport } = recordingTransport();
    assertThrows(
      () => sendToEvmWithData({ transport, wallet, signatureChainId: "0x66eee" }, { ...BASE_PARAMS, data: "0x123" }),
      ValidationError,
    );
  });

  test("rejects 0X-prefixed data", () => {
    const { transport } = recordingTransport();
    assertThrows(
      () => sendToEvmWithData({ transport, wallet, signatureChainId: "0x66eee" }, { ...BASE_PARAMS, data: "0X0123" }),
      ValidationError,
    );
  });

  test("accepts even-length hex data and empty data", async () => {
    const { transport, payloads } = recordingTransport();

    for (const data of ["0x0123", "0x"]) {
      await sendToEvmWithData({ transport, wallet, signatureChainId: "0x66eee" }, { ...BASE_PARAMS, data });
    }

    assertEquals(
      payloads.map((p) => p.action.data),
      ["0x0123", "0x"],
    );
  });
});
