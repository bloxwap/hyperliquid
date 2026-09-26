/**
 * Tests for how the explorer request helpers surface server-side error envelopes.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { ApiRequestError, blockDetails } from "@bloxwap/hyperliquid/api/explorer";

/** Creates a transport stub that resolves every request with the given response. */
function transportWith(response: unknown): IRequestTransport<"explorer"> {
  return {
    isTestnet: false,
    request<T>(): Promise<T> {
      return Promise.resolve(response as T);
    },
  };
}

describe("explorer error responses", () => {
  test("error response throws ApiRequestError with the server message", async () => {
    const transport = transportWith({ type: "error", message: "invalid block height: 0" });

    const error = await assertRejects(
      () => blockDetails({ transport }, { height: 1 }),
      ApiRequestError,
      "invalid block height: 0",
    );
    assertEquals(error.response, { type: "error", message: "invalid block height: 0" });
  });

  test("error response without message throws with a generic message", async () => {
    const transport = transportWith({ type: "error" });

    await assertRejects(() => blockDetails({ transport }, { height: 1 }), ApiRequestError, "An unknown error occurred");
  });

  test("successful response is returned as data", async () => {
    const data = { type: "blockDetails", blockDetails: { height: 1 } };
    const transport = transportWith(data);

    assertEquals(await blockDetails({ transport }, { height: 1 }), data);
  });
});
