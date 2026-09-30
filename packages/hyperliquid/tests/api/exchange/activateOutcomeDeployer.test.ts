import { ApiRequestError } from "@bloxwap/hyperliquid";
import {
  type ActivateOutcomeDeployerParameters,
  ActivateOutcomeDeployerRequest,
  activateOutcomeDeployer,
} from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { FIXED_NONCE, recordingTransport, singleWalletConfig } from "./_mockTransport.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(ActivateOutcomeDeployerRequest.entries.action);

runTest({
  name: "activateOutcomeDeployer",
  codeTestFn: async (_t, exchClient) => {
    const params: ActivateOutcomeDeployerParameters[] = [
      // activate
      { activate: { venueName: "ab" } },
      // deactivate
      { deactivate: null },
    ];

    await assertRejects(
      async () => {
        await exchClient.activateOutcomeDeployer(params[0]);
      },
      ApiRequestError,
      "Insufficient stake",
    );
    await assertRejects(
      async () => {
        await exchClient.activateOutcomeDeployer(params[1]);
      },
      ApiRequestError,
      "Error deploying outcome: not an outcome deployer",
    );

    schemaCoverage(
      paramsSchema,
      params.map((p) => ({ type: "activateOutcomeDeployer", ...p })),
    );
  },
});

// ============================================================
// Offline: wire payload and signature for both activation directions
// ============================================================

describe("activateOutcomeDeployer (offline)", () => {
  test("posts both venue activation variants and rejects mixed/legacy input", async () => {
    for (const params of [{ activate: { venueName: "ab" } }, { deactivate: null }] as const) {
      const { calls, transport } = recordingTransport();
      await activateOutcomeDeployer(singleWalletConfig(transport), params);
      assertEquals(calls[0].payload.action, { type: "activateOutcomeDeployer", ...params });
      assertEquals(calls[0].payload.nonce, FIXED_NONCE);
    }
    for (const params of [
      { isDeactivate: false },
      { activate: { venueName: "ab" }, deactivate: null },
      { activate: { venueName: "A" } },
    ]) {
      const { calls, transport } = recordingTransport();
      await assertRejects(async () => activateOutcomeDeployer(singleWalletConfig(transport), params as never));
      assertEquals(calls.length, 0);
    }
  });
});

// Golden signatures pin the new activation envelope at the shared fixture nonce.
describe("activateOutcomeDeployer golden vectors", () => {
  test("venue activation and permanent deactivation sign the exact wire envelope", async () => {
    const vectors = [
      [
        { activate: { venueName: "ab" } },
        {
          r: "0x7450adb51d086b9c31dae14cd4a1c5d190409ceaf5038f0758eee694bb8a9995",
          s: "0x55f3ee595785e17cade1199cdf40ec9ad10fd6213e0c3e47e682404dd63091aa",
          v: 28,
        },
      ],
      [
        { deactivate: null },
        {
          r: "0xf36ff939c53699e890ee20a9b312858bc36e24f2f51ef26849cebe549aa8694f",
          s: "0x64804292791001893e3df9bfd1623fbe2f785dd3709a9e0b031e559334a0a75d",
          v: 27,
        },
      ],
    ] as const;
    for (const [params, signature] of vectors) {
      const { transport, calls } = recordingTransport();
      await activateOutcomeDeployer(singleWalletConfig(transport), params);
      assertEquals(calls[0].payload.signature, signature);
    }
  });
});
