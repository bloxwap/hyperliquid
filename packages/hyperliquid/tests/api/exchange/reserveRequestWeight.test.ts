import { type ReserveRequestWeightParameters, ReserveRequestWeightRequest } from "@bloxwap/hyperliquid/api/exchange";
import { reserveRequestWeight } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { FIXED_NONCE, recordingTransport, singleWalletConfig } from "./_mockTransport.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/reserveRequestWeight.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "ReserveRequestWeightSuccessResponse");
const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(ReserveRequestWeightRequest.entries.action.entries), ["type"]),
);

runTest({
  name: "reserveRequestWeight",
  codeTestFn: async (_t, exchClient) => {
    const params: ReserveRequestWeightParameters[] = [
      // no destination
      { weight: 1 },
      // destination
      { weight: 1, destination: "0xe019d6167e7e324aed003d94098496b6d986ab05" },
    ];

    const data = await Promise.all(params.map((p) => exchClient.reserveRequestWeight(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: `destination` flows into the L1 action hash when set and is skipped when UNSET
// ============================================================

describe("reserveRequestWeight (offline)", () => {
  test("omits destination from the action and hash when unset", async () => {
    const { calls, transport } = recordingTransport();

    await reserveRequestWeight(singleWalletConfig(transport), { weight: 1 });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, { type: "reserveRequestWeight", weight: 1 });
    assertEquals("destination" in calls[0].payload.action, false);
    assertEquals(calls[0].payload.nonce, FIXED_NONCE);
    // Pinned signature over { type, weight } — the hash preimage carries no destination entry.
    assertEquals(calls[0].payload.signature, {
      r: "0xa945457c63f9bb786559d7408de7c0c0eca6c6cd59eae60bab1a07152041bc77",
      s: "0x156325bb4d59b6083d1abc6b50024ddba3f5eab93f9da323225f75df9e941917",
      v: 28,
    });
  });

  test("includes destination in the action and hash when set", async () => {
    const { calls, transport } = recordingTransport();

    await reserveRequestWeight(singleWalletConfig(transport), {
      weight: 1,
      destination: "0xe019d6167e7e324aed003d94098496b6d986ab05",
    });

    assertEquals(calls.length, 1);
    assertEquals(calls[0].payload.action, {
      type: "reserveRequestWeight",
      weight: 1,
      destination: "0xe019d6167e7e324aed003d94098496b6d986ab05",
    });
    // Different signature from the unset case: destination changed the L1 action hash.
    assertEquals(calls[0].payload.signature, {
      r: "0xba58246509cee6d97b00063e1f13def62f8fb3ea496ca32bc9259f2517783045",
      s: "0x519e413183bb2adaf70e150803e32f9093f461a08645f8a7af6e39ad960a604d",
      v: 28,
    });
  });
});
