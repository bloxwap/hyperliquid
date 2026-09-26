import { ApiRequestError } from "@bloxwap/hyperliquid";
import { assertRejects } from "@jsr/std__assert";
import { runTest } from "./_t.ts";

runTest({
  name: "claimRewards",
  codeTestFn: async (_t, exchClient) => {
    await assertRejects(
      async () => {
        await exchClient.claimRewards();
      },
      ApiRequestError,
      "No rewards to claim",
    );
  },
});
