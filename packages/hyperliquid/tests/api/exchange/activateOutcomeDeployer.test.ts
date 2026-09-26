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

const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(ActivateOutcomeDeployerRequest.entries.action.entries), ["type"]),
);

runTest({
  name: "activateOutcomeDeployer",
  codeTestFn: async (_t, exchClient) => {
    const params: ActivateOutcomeDeployerParameters[] = [
      // activate
      { isDeactivate: false },
      // deactivate
      { isDeactivate: true },
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

    schemaCoverage(paramsSchema, params);
  },
});

// ============================================================
// Offline: wire payload and signature for both activation directions
// ============================================================

describe("activateOutcomeDeployer (offline)", () => {
  test("posts the exact action with a deterministic signature (fixed nonce and wallet)", async () => {
    for (const [params, expectedSignature] of [
      [
        { isDeactivate: false },
        {
          r: "0x301138913ffc553e9c0aed05982601cfaca2c0ea1bdf253695cb9dbfb0797a81",
          s: "0x102f87b005f398872b39adb47bd9688768784896d2e2f8fdb7e68f85373870c8",
          v: 28,
        },
      ],
      [
        { isDeactivate: true },
        {
          r: "0x14f0821a33e2cfbbada1a27891eb956ced25bee71ff7f004438fec57c1491e66",
          s: "0x55826b27bb1fb76223b21e3908ad207f03a713d3dcd2705761fe1ed79232c96b",
          v: 28,
        },
      ],
    ] as const) {
      const { calls, transport } = recordingTransport();

      await activateOutcomeDeployer(singleWalletConfig(transport), params);

      assertEquals(calls.length, 1);
      assertEquals(calls[0].endpoint, "exchange");
      assertEquals(calls[0].payload.action, { type: "activateOutcomeDeployer", ...params });
      assertEquals(calls[0].payload.nonce, FIXED_NONCE);
      assertEquals(calls[0].payload.signature, expectedSignature);
    }
  });
});
