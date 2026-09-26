import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type VaultTransferParameters, VaultTransferRequest } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(v.omit(v.object(VaultTransferRequest.entries.action.entries), ["type"]));

runTest({
  name: "vaultTransfer",
  codeTestFn: async (_t, exchClient) => {
    const params: VaultTransferParameters[] = [
      // isDeposit=true
      {
        vaultAddress: "0x457ab3acf4a4e01156ce269545a9d3d05fff2f0b",
        isDeposit: true,
        usd: 5 * 1e6,
      },
      // isDeposit=false
      {
        vaultAddress: "0x457ab3acf4a4e01156ce269545a9d3d05fff2f0b",
        isDeposit: false,
        usd: 5 * 1e6,
      },
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(async () => {
          await exchClient.vaultTransfer(p);
        }, ApiRequestError),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});
