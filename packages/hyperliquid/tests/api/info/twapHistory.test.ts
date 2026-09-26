import { twapHistory, type TwapHistoryParameters, TwapHistoryRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/twapHistory.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "TwapHistoryResponse");
const paramsSchema = valibotToJsonSchema(v.omit(TwapHistoryRequest, ["type"]));

runTest({
  name: "twapHistory",
  isTestnet: false,
  codeTestFn: async (_t, client) => {
    const params: TwapHistoryParameters[] = [
      { user: "0x03ce7863a2b62f4e227fd98605b79beb32618c76" }, // trigger.above: true
      { user: "0x0132157369b0d073dd99011da1777920a025fd77" }, // trigger.above: false
      { user: "0x051748895c6ed4fab50828bebe8e62e665134d23" }, // stopped and non-null stopPx
      { user: "0x06d5af06a3a7d29909e1cdc7a9deded2fb14ab57" }, // error and historical entries without twapId
    ];

    const data = await Promise.all(params.map((p) => client.twapHistory(p)));

    schemaCoverage(paramsSchema, params);
    // Current responses include trigger/stopPx even when unset. The offline block below
    // covers older responses that omit them; the live accounts cover non-null values and every status.
    schemaCoverage(responseSchema, data, [
      "#/items/properties/state/properties/trigger/missing",
      "#/items/properties/state/properties/stopPx/missing",
    ]);
  },
});

// ============================================================
// Offline: wire drift — states carry trigger/stopPx (issue #48)
// ============================================================

describe("twapHistory (offline)", () => {
  // Captured verbatim from mainnet twapHistory on 2026-07-26: every state object carries
  // `"trigger":null,"stopPx":null` — fields the SDK type previously lacked (#48).
  const liveSample = {
    time: 1784834637,
    state: {
      coin: "@107",
      user: "0x7839e2f2c375dd2935193f2736167514efff9916",
      side: "B",
      sz: "1000.0",
      executedSz: "1000.0",
      executedNtl: "58961.64033",
      minutes: 330,
      reduceOnly: false,
      randomize: true,
      timestamp: 1784814835868,
      trigger: null,
      stopPx: null,
    },
    status: { status: "finished" },
    twapId: 2052302,
  };

  test("live-shaped states with trigger/stopPx satisfy the response schema", () => {
    // Covers every schema branch: side B/A, trigger present-null/present-non-null/absent,
    // stopPx present-null/present-non-null/absent, all statuses (including waitingForTrigger
    // and stopped from #100), twapId present/absent.
    const samples = [
      liveSample,
      {
        time: 1784814835,
        state: {
          coin: "@107",
          user: "0x7839e2f2c375dd2935193f2736167514efff9916",
          side: "A",
          sz: "1000.0",
          executedSz: "0.0",
          executedNtl: "0.0",
          minutes: 330,
          reduceOnly: true,
          randomize: false,
          timestamp: 1784814835868,
          // trigger and stopPx absent (not set on pre-field-availability responses)
        },
        status: { status: "activated" },
        // twapId absent on pre-id-availability responses
      },
      {
        time: 1732937608,
        state: {
          coin: "HYPE",
          user: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00",
          side: "A",
          sz: "144.36",
          executedSz: "50.13",
          executedNtl: "348.294323",
          minutes: 5,
          reduceOnly: false,
          randomize: true,
          timestamp: 1732937510435,
          trigger: { px: "25.5", above: false }, // settable via twapOrder `details` (#100)
          stopPx: "25.5",
        },
        status: { status: "terminated" },
        twapId: 1873180,
      },
      {
        time: 1732937609,
        state: {
          coin: "HYPE",
          user: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00",
          side: "B",
          sz: "144.36",
          executedSz: "0.0",
          executedNtl: "0.0",
          minutes: 5,
          reduceOnly: false,
          randomize: true,
          timestamp: 1732937510435,
        },
        status: { status: "error", description: "Twap fill failure: insufficient balance" },
        twapId: 1873181,
      },
      {
        time: 1784814900,
        state: {
          coin: "HYPE",
          user: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00",
          side: "B",
          sz: "144.36",
          executedSz: "0.0",
          executedNtl: "0.0",
          minutes: 5,
          reduceOnly: false,
          randomize: false,
          timestamp: 1732937510435,
          trigger: { px: "30.0", above: true },
          stopPx: null,
        },
        status: { status: "waitingForTrigger" },
        twapId: 1873182,
      },
      {
        time: 1784815000,
        state: {
          coin: "HYPE",
          user: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00",
          side: "B",
          sz: "144.36",
          executedSz: "50.13",
          executedNtl: "348.294323",
          minutes: 5,
          reduceOnly: false,
          randomize: false,
          timestamp: 1732937510435,
          trigger: null,
          stopPx: "20.0",
        },
        status: { status: "stopped" },
        twapId: 1873183,
      },
    ];
    schemaCoverage(responseSchema, [samples]);
  });
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "twapHistory",
  method: twapHistory,
  signature: "params",
  cases: [{ params: { user: "0x0000000000000000000000000000000000000001" } }],
  invalidParams: [{ user: "0x123" }, {}],
});
