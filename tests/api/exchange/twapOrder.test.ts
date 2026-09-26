import { type TwapOrderParameters, TwapOrderRequest, twapOrder } from "@bloxwap/hyperliquid/api/exchange";
import { formatPrice, formatSize } from "@bloxwap/hyperliquid/utils";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { FIXED_NONCE, recordingTransport, singleWalletConfig } from "./_mockTransport.ts";
import { allMids, runTest, symbolConverter, topUpPerp } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/twapOrder.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "TwapOrderSuccessResponse");
const paramsSchema = valibotToJsonSchema(v.omit(v.object(TwapOrderRequest.entries.action.entries), ["type"]));

runTest({
  name: "twapOrder",
  codeTestFn: async (_t, exchClient) => {
    await topUpPerp(exchClient, "130");

    const id = symbolConverter.getAssetId("SOL")!;
    const szDecimals = symbolConverter.getSzDecimals("SOL")!;
    const midPx = allMids["SOL"];

    // Leave room for size rounding above the $100 minimum TWAP notional.
    const sz = formatSize(110 / parseFloat(midPx), szDecimals);
    const pxUp = formatPrice(parseFloat(midPx) * 1.5, szDecimals);
    const pxDown = formatPrice(parseFloat(midPx) * 0.5, szDecimals);

    const params: TwapOrderParameters[] = [
      // b=true | r=false | t=false
      { twap: { a: id, b: true, s: sz, r: false, m: 5, t: false } },
      // b=false | t=true
      { twap: { a: id, b: false, s: sz, r: false, m: 5, t: true } },
      // details.t | a=true
      { twap: { a: id, b: true, s: sz, r: false, m: 5, t: false }, details: { t: { p: pxUp, a: true }, s: null } },
      // details.t | a=false
      { twap: { a: id, b: false, s: sz, r: false, m: 5, t: false }, details: { t: { p: pxDown, a: false }, s: null } },
      // details.s
      { twap: { a: id, b: true, s: sz, r: false, m: 5, t: false }, details: { t: null, s: pxUp } },
    ];

    const data = await Promise.all(params.map((p) => exchClient.twapOrder(p)));

    schemaCoverage(paramsSchema, params, [
      "#/properties/twap/properties/r/boolean/true", // r=true requires existing position
    ]);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: `details` flows into the L1 action hash when set and is skipped when UNSET
// ============================================================

describe("twapOrder (offline)", () => {
  const twap = { a: 0, b: true, s: "0.1", r: false, m: 5, t: false } as const;

  test("omits details from the action and hash when unset", async () => {
    const { calls, transport } = recordingTransport();

    await twapOrder(singleWalletConfig(transport), { twap });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "twapOrder", twap });
    assertEquals("details" in calls[0].payload.action, false);
    assertEquals(calls[0].payload.nonce, FIXED_NONCE);
    // Pinned signature over { type, twap } — the hash preimage carries no details entry.
    assertEquals(calls[0].payload.signature, {
      r: "0x5d55de850a87b5e9d2888b127f7c7affb93741a29f9fd1ccaa16cd43584acace",
      s: "0x4c06e405d2f84173703a418a2a783139e063df11230c09ceae8a15e4edc43080",
      v: 28,
    });
  });

  test("includes trigger details in the action and hash when set", async () => {
    const { calls, transport } = recordingTransport();
    const details = { t: { p: "100", a: true }, s: null } as const;

    await twapOrder(singleWalletConfig(transport), { twap, details });

    assertEquals(calls[0].payload.action, { type: "twapOrder", twap, details });
    assertEquals(calls[0].payload.signature, {
      r: "0xb6cd37d718485c73996638967dd7350d449ec75046c0155265fb815ca8d40929",
      s: "0x268a890c0ada877f47cfe0317013bb78fd1a65713b1b6e814eaf0724ead38f9b",
      v: 27,
    });
  });

  test("includes stop details in the action and hash when set", async () => {
    const { calls, transport } = recordingTransport();
    const details = { t: null, s: "100" } as const;

    await twapOrder(singleWalletConfig(transport), { twap, details });

    assertEquals(calls[0].payload.action, { type: "twapOrder", twap, details });
    assertEquals(calls[0].payload.signature, {
      r: "0x9277f680d164203adb56f3644c1d7e997f24b4174b7b9c3d3eccfdc60e7c5d90",
      s: "0x21f66746dc7f89f81bcf2720d38338e0d35a02eec6156bb19c9673150d5bcd88",
      v: 28,
    });
  });
});
