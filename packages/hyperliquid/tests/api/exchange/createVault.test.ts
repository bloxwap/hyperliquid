import { ApiRequestError } from "@bloxwap/hyperliquid";
import { type CreateVaultParameters, CreateVaultRequest } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { assertRejects } from "@jsr/std__assert";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(CreateVaultRequest.entries.action.entries), ["type", "nonce"]),
);

runTest({
  name: "createVault",
  codeTestFn: async (_t, exchClient) => {
    const params: CreateVaultParameters[] = [
      {
        name: "test",
        description: "1234567890",
        initialUsd: Number.MAX_SAFE_INTEGER,
      },
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(
          async () => {
            await exchClient.createVault(p);
          },
          ApiRequestError,
          "Insufficient balance to create vault",
        ),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});
