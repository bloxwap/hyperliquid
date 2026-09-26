import { type BlockDetailsParameters, BlockDetailsRequest, blockDetails } from "@bloxwap/hyperliquid/api/explorer";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runRequestTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/explorer/_methods/blockDetails.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "BlockDetailsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(BlockDetailsRequest, ["type"]));

runRequestTest({
  name: "blockDetails",
  fn: async (_t, client) => {
    const params: BlockDetailsParameters[] = [{ height: 300836507 }];

    const data = await Promise.all(params.map((p) => client.blockDetails(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: exact payload, validation, and passthrough against a mock transport
// ============================================================

import { describe, test } from "bun:test";
import { assertEquals, assertRejects, assertStrictEquals } from "@jsr/std__assert";
import { TransportError, ValidationError } from "@bloxwap/hyperliquid";
import { ApiRequestError } from "@bloxwap/hyperliquid/api/explorer";
import { MockExplorerTransport } from "./_mockTransport.ts";

describe("blockDetails (offline)", () => {
  test("sends the validated request to the explorer endpoint", async () => {
    const response = { type: "blockDetails", blockDetails: { height: 123 } };
    const transport = new MockExplorerTransport(() => response);

    const result = await blockDetails({ transport }, { height: 123 });

    assertEquals(transport.calls.length, 1);
    assertEquals(transport.calls[0].endpoint, "explorer");
    assertEquals(transport.calls[0].payload, { type: "blockDetails", height: 123 });
    assertStrictEquals(result, response);
  });

  test("accepts the height as a decimal string", async () => {
    const transport = new MockExplorerTransport();

    await blockDetails({ transport }, { height: "123" });

    assertEquals(transport.calls[0].payload, { type: "blockDetails", height: 123 });
  });

  test("passes the abort signal to the transport", async () => {
    const transport = new MockExplorerTransport();
    const controller = new AbortController();

    await blockDetails({ transport }, { height: 1 }, controller.signal);

    assertStrictEquals(transport.calls[0].signal, controller.signal);
  });

  test("rejects invalid params before any request is sent", async () => {
    const transport = new MockExplorerTransport();

    await assertRejects(() => blockDetails({ transport }, { height: -1 }), ValidationError);
    await assertRejects(() => blockDetails({ transport }, { height: 1.5 }), ValidationError);
    await assertRejects(() => blockDetails({ transport }, { height: "abc" }), ValidationError);

    assertEquals(transport.calls.length, 0);
  });

  test("an error response throws ApiRequestError", async () => {
    const transport = new MockExplorerTransport(() => ({ type: "error", message: "invalid block height: 0" }));

    await assertRejects(() => blockDetails({ transport }, { height: 1 }), ApiRequestError, "invalid block height: 0");
  });

  test("transport errors propagate", async () => {
    const transport = new MockExplorerTransport();
    transport.error = new TransportError("connection lost");

    await assertRejects(() => blockDetails({ transport }, { height: 1 }), TransportError, "connection lost");
  });
});
