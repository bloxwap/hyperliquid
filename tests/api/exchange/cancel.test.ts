import { type CancelParameters, CancelRequest, cancel } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertThrows } from "@jsr/std__assert";
import { ValidationError } from "@bloxwap/hyperliquid";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { openOrder, runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/cancel.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "CancelSuccessResponse");
const paramsSchema = valibotToJsonSchema(v.omit(v.object(CancelRequest.entries.action.entries), ["type"]));

runTest({
  name: "cancel",
  codeTestFn: async (_t, exchClient) => {
    // standard
    const standard = await (async () => {
      const order = await openOrder(exchClient, "limit");
      const params: CancelParameters = { cancels: [{ a: order.a, o: order.oid }] };
      return { params, result: await exchClient.cancel(params) };
    })();

    // fast
    const fast = await (async () => {
      const order = await openOrder(exchClient, "limit");
      const params: CancelParameters = { cancels: [{ a: order.a, o: order.oid }], f: true };
      return { params, result: await exchClient.cancel(params) };
    })();

    const data = [standard, fast];

    schemaCoverage(
      paramsSchema,
      data.map((d) => d.params),
    );
    schemaCoverage(
      responseSchema,
      data.map((d) => d.result),
    );
  },
});

// ============================================================
// Offline: an empty cancels array is rejected before sending (the server rejects empty batches)
// ============================================================

describe("cancel (offline)", () => {
  test("empty cancels array fails validation before sending", () => {
    const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const transport: IRequestTransport = {
      isTestnet: true,
      request: () => Promise.reject(new Error("must not be sent")),
    };

    assertThrows(() => cancel({ transport, wallet }, { cancels: [] }), ValidationError, "Invalid length");
  });
});
