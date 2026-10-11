import { ApiRequestError, ValidationError } from "@bloxwap/hyperliquid";
import { type TrailingStopParameters, TrailingStopRequest, trailingStop } from "@bloxwap/hyperliquid/api/exchange";
import { formatPrice } from "@bloxwap/hyperliquid/utils";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { FIXED_NONCE, recordingTransport, singleWalletConfig } from "./_mockTransport.ts";
import { openOrder, runTest, symbolConverter, topUpPerp } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/trailingStop.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "TrailingStopSuccessResponse");
const paramsSchema = valibotToJsonSchema(v.omit(v.object(TrailingStopRequest.entries.action.entries), ["type"]));

runTest({
  name: "trailingStop",
  codeTestFn: async (_t, exchClient) => {
    await topUpPerp(exchClient, "30");
    const opened = await openOrder(exchClient, "market", "SOL");

    const szDecimals = symbolConverter.getSzDecimals("SOL")!;
    const midPx = parseFloat(opened.midPx);

    const params: TrailingStopParameters[] = [
      // pct retracement | reduce-only sell trailing the opened long | activates immediately
      { asset: opened.a, isBuy: false, sz: opened.s, reduceOnly: true, retracement: { pct: "5%" }, activationPx: null },
      // px retracement | buy side | deferred activation above the current price
      {
        asset: opened.a,
        isBuy: true,
        sz: "0.1",
        reduceOnly: false,
        retracement: { px: formatPrice(midPx * 0.05, szDecimals) },
        activationPx: formatPrice(midPx * 1.1, szDecimals),
      },
    ];

    const data = await Promise.all(params.map((p) => exchClient.trailingStop(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: retracement variants and activationPx flow into the L1 action
// ============================================================

const TRAILING_STOP = {
  asset: 0,
  isBuy: true,
  sz: "0.1",
  reduceOnly: false,
  retracement: { pct: "1.234%" },
  activationPx: "30000",
} as const;

describe("trailingStop (offline)", () => {
  test("a pct retracement posts the exact wire action", async () => {
    const { calls, transport } = recordingTransport();

    await trailingStop(singleWalletConfig(transport), TRAILING_STOP);

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "trailingStop", ...TRAILING_STOP });
    assertEquals(calls[0].payload.nonce, FIXED_NONCE);
    // Pinned signature over the full action — the hash preimage carries every field.
    assertEquals(calls[0].payload.signature, {
      r: "0x59eed0cdff8d6b5261e1f52feb37e4da7c3f256e74c152c108d5bae370e54679",
      s: "0x20e2655aed29e363e0d7b8e43ea1d5e020377af5c1fd79bd23102b7329987ba7",
      v: 27,
    });
  });

  test("a px retracement posts the exact wire action", async () => {
    const { calls, transport } = recordingTransport();

    await trailingStop(singleWalletConfig(transport), { ...TRAILING_STOP, retracement: { px: "100" } });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "trailingStop", ...TRAILING_STOP, retracement: { px: "100" } });
  });

  test("a null activationPx is carried into the wire action", async () => {
    const { calls, transport } = recordingTransport();

    await trailingStop(singleWalletConfig(transport), { ...TRAILING_STOP, activationPx: null });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "trailingStop", ...TRAILING_STOP, activationPx: null });
  });

  test("malformed inputs fail validation with zero requests sent", async () => {
    const { calls, transport } = recordingTransport();
    const config = singleWalletConfig(transport);

    // Percent string without the `%` suffix.
    await assertRejects(
      async () => await trailingStop(config, { ...TRAILING_STOP, retracement: { pct: "1.234" } }),
      ValidationError,
    );
    // Retracement variant with neither `pct` nor `px`.
    await assertRejects(
      async () => await trailingStop(config, { ...TRAILING_STOP, retracement: {} as never }),
      ValidationError,
    );
    // Negative activation price.
    await assertRejects(
      async () => await trailingStop(config, { ...TRAILING_STOP, activationPx: "-30000" }),
      ValidationError,
    );
    assertEquals(calls.length, 0);
  });

  test("the success response exposes the order id at data.oid", async () => {
    const response = { status: "ok", response: { type: "trailingStop", data: { oid: 77738308 } } } as const;
    const { transport } = recordingTransport(response);

    const data = await trailingStop(singleWalletConfig(transport), TRAILING_STOP);

    assertEquals(data, response);
    // Type-level: the success variant narrows `data` to `{ oid: number }`.
    const oid: number = data.response.data.oid;
    assertEquals(oid, 77738308);
  });

  test("a data-level error envelope rejects with ApiRequestError", async () => {
    const response = { status: "ok", response: { type: "trailingStop", data: { error: "Unknown asset" } } } as const;
    const { transport } = recordingTransport(response);

    const error = await assertRejects(
      async () => await trailingStop(singleWalletConfig(transport), TRAILING_STOP),
      ApiRequestError,
      "Unknown asset",
    );
    assertEquals(error.response, response);
  });
});
