import { type TxDetailsParameters, TxDetailsRequest, txDetails } from "@bloxwap/hyperliquid/api/explorer";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runRequestTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/explorer/_methods/txDetails.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "TxDetailsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(TxDetailsRequest, ["type"]));

runRequestTest({
  name: "txDetails",
  fn: async (_t, client) => {
    const params: TxDetailsParameters[] = [
      { hash: "0x4de9f1f5d912c23d8fbb0411f01bfe0000eb9f3ccb3fec747cb96e75e8944b06" }, // error = null
      { hash: "0x8f1b2b67eda04ecbc7b00411ee669b010c0041e8f52c9ff5c3609d9ef7e66c71" }, // error = string
    ];

    const data = await Promise.all(params.map((p) => client.txDetails(p)));

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

const HASH = "0x4de9f1f5d912c23d8fbb0411f01bfe0000eb9f3ccb3fec747cb96e75e8944b06";

describe("txDetails (offline)", () => {
  test("sends the validated request to the explorer endpoint", async () => {
    const response = { type: "txDetails", tx: { hash: HASH } };
    const transport = new MockExplorerTransport(() => response);

    const result = await txDetails({ transport }, { hash: HASH });

    assertEquals(transport.calls.length, 1);
    assertEquals(transport.calls[0].endpoint, "explorer");
    assertEquals(transport.calls[0].payload, { type: "txDetails", hash: HASH });
    assertStrictEquals(result, response);
  });

  test("passes the abort signal to the transport", async () => {
    const transport = new MockExplorerTransport();
    const controller = new AbortController();

    await txDetails({ transport }, { hash: HASH }, controller.signal);

    assertStrictEquals(transport.calls[0].signal, controller.signal);
  });

  test("rejects invalid params before any request is sent", async () => {
    const transport = new MockExplorerTransport();

    await assertRejects(() => txDetails({ transport }, { hash: "0x1234" }), ValidationError); // too short
    await assertRejects(() => txDetails({ transport }, { hash: "not-hex" }), ValidationError); // not hex

    assertEquals(transport.calls.length, 0);
  });

  test("an error response throws ApiRequestError", async () => {
    const transport = new MockExplorerTransport(() => ({ type: "error", message: "tx not found" }));

    await assertRejects(() => txDetails({ transport }, { hash: HASH }), ApiRequestError, "tx not found");
  });

  test("transport errors propagate", async () => {
    const transport = new MockExplorerTransport();
    transport.error = new TransportError("connection lost");

    await assertRejects(() => txDetails({ transport }, { hash: HASH }), TransportError, "connection lost");
  });
});
