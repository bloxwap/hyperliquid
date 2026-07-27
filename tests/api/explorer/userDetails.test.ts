import { type UserDetailsParameters, UserDetailsRequest, userDetails } from "@bloxwap/hyperliquid/api/explorer";
import * as v from "valibot";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runRequestTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/explorer/_methods/userDetails.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "UserDetailsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(UserDetailsRequest, ["type"]));

runRequestTest({
  name: "userDetails",
  isTestnet: false,
  fn: async (_t, client) => {
    const params: UserDetailsParameters[] = [{ user: "0x9150749C4cec13Dc7c1555D0d664F08d4d81Be83" }];

    const data = await Promise.all(params.map((p) => client.userDetails(p)));

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

const USER = "0x9150749c4cec13dc7c1555d0d664f08d4d81be83";

describe("userDetails (offline)", () => {
  test("sends the validated request to the explorer endpoint", async () => {
    const response = { type: "userDetails", txs: [] };
    const transport = new MockExplorerTransport(() => response);

    const result = await userDetails({ transport }, { user: USER });

    assertEquals(transport.calls.length, 1);
    assertEquals(transport.calls[0].endpoint, "explorer");
    assertEquals(transport.calls[0].payload, { type: "userDetails", user: USER });
    assertStrictEquals(result, response);
  });

  test("lowercases a mixed-case address", async () => {
    const transport = new MockExplorerTransport();

    await userDetails({ transport }, { user: "0x9150749C4cec13Dc7c1555D0d664F08d4d81Be83" });

    assertEquals(transport.calls[0].payload, { type: "userDetails", user: USER });
  });

  test("passes the abort signal to the transport", async () => {
    const transport = new MockExplorerTransport();
    const controller = new AbortController();

    await userDetails({ transport }, { user: USER }, controller.signal);

    assertStrictEquals(transport.calls[0].signal, controller.signal);
  });

  test("rejects invalid params before any request is sent", async () => {
    const transport = new MockExplorerTransport();

    await assertRejects(() => userDetails({ transport }, { user: "0x1234" }), ValidationError); // too short
    await assertRejects(() => userDetails({ transport }, { user: "not-an-address" }), ValidationError); // not hex

    assertEquals(transport.calls.length, 0);
  });

  test("an error response throws ApiRequestError", async () => {
    const transport = new MockExplorerTransport(() => ({ type: "error", message: "user not found" }));

    await assertRejects(() => userDetails({ transport }, { user: USER }), ApiRequestError, "user not found");
  });

  test("transport errors propagate", async () => {
    const transport = new MockExplorerTransport();
    transport.error = new TransportError("connection lost");

    await assertRejects(() => userDetails({ transport }, { user: USER }), TransportError, "connection lost");
  });
});
