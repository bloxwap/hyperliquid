/**
 * Tests for how exchange request helpers surface server-side error envelopes — including
 * per-order errors nested inside an otherwise `status: "ok"` response (a failure mode where
 * rejected orders used to look successful).
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { ApiRequestError, order } from "@bloxwap/hyperliquid/api/exchange";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

/** Creates a transport stub that resolves every request with the given response. */
function transportWith(response: unknown): IRequestTransport {
  return {
    isTestnet: true,
    request<T>(): Promise<T> {
      return Promise.resolve(response as T);
    },
  };
}

const LIMIT_ORDER = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } } as const;

describe("exchange error responses", () => {
  test("nested per-order error throws ApiRequestError", async () => {
    const response = {
      status: "ok",
      response: { type: "order", data: { statuses: [{ error: "Insufficient margin" }] } },
    };

    const error = await assertRejects(
      () => order({ transport: transportWith(response), wallet }, { orders: [LIMIT_ORDER] }),
      ApiRequestError,
      "Insufficient margin",
    );
    assertEquals(error.response, response);
  });

  test("top-level error response throws ApiRequestError with the server message", async () => {
    const response = { status: "err", response: "Must deposit before performing actions." };

    const error = await assertRejects(
      () => order({ transport: transportWith(response), wallet }, { orders: [LIMIT_ORDER] }),
      ApiRequestError,
      "Must deposit before performing actions.",
    );
    assertEquals(error.response, response);
  });

  test("successful response without per-order errors is returned as data", async () => {
    const response: Awaited<ReturnType<typeof order>> = {
      status: "ok",
      response: { type: "order", data: { statuses: [{ resting: { oid: 123 } }] } },
    };

    assertEquals(await order({ transport: transportWith(response), wallet }, { orders: [LIMIT_ORDER] }), response);
  });
});
