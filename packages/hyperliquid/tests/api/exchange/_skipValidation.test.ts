/**
 * Tests for the opt-in `skipValidation` fast path: the skipped path must produce wire output
 * identical to the validated path for valid input, and must defer rejection of invalid input
 * to the server (the caller's problem, by design).
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertThrows } from "@jsr/std__assert";
import { type IRequestTransport, ValidationError } from "@bloxwap/hyperliquid";
import { order, type OrderParameters } from "@bloxwap/hyperliquid/api/exchange";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

const ORDER_SUCCESS = {
  status: "ok",
  response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } },
} as const;

/** A single order, shaped exactly as it goes over the wire (canonical key order, normalized values). */
const LIMIT_ORDER = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } } as const;
const PARAMS: OrderParameters = { orders: [LIMIT_ORDER], grouping: "na" };

/** Creates a transport that records every posted payload and resolves with a successful order response. */
function recordingTransport(): { calls: unknown[]; transport: IRequestTransport } {
  const calls: unknown[] = [];
  return {
    calls,
    transport: {
      isTestnet: true,
      request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        calls.push(payload);
        return Promise.resolve(ORDER_SUCCESS as T);
      },
    },
  };
}

describe("skipValidation", () => {
  test("produces wire output identical to the validated path for valid input", async () => {
    const { calls, transport } = recordingTransport();
    // Fixed nonce so the two payloads are comparable byte-for-byte (the signature commits to it).
    const config = { transport, wallet, nonceManager: () => 1700000000000 };

    await order(config, PARAMS);
    await order(config, PARAMS, { skipValidation: true });

    assertEquals(calls.length, 2);
    assertEquals(calls[1], calls[0]);
  });

  test("produces wire output identical to the validated path with vaultAddress and expiresAfter", async () => {
    const { calls, transport } = recordingTransport();
    const config = { transport, wallet, nonceManager: () => 1700000000000 };
    const opts = {
      vaultAddress: "0x1234567890123456789012345678901234567890" as const,
      expiresAfter: 1700000060000,
    };

    await order(config, PARAMS, opts);
    await order(config, PARAMS, { ...opts, skipValidation: true });

    assertEquals(calls.length, 2);
    assertEquals(calls[1], calls[0]);
  });

  test("invalid input throws client-side on the validated path but is deferred to the server on the skipped path", async () => {
    const { transport } = recordingTransport();
    const config = { transport, wallet };
    // Type-valid but schema-invalid: negative asset id, non-decimal price.
    const badParams: OrderParameters = { orders: [{ ...LIMIT_ORDER, a: -1, p: "abc" }], grouping: "na" };

    assertThrows(() => order(config, badParams), ValidationError);

    // The skipped path performs no client-side validation: the request is signed and posted
    // as-is, and rejecting it becomes the server's job (the mock server accepts everything).
    await order(config, badParams, { skipValidation: true });
  });

  test("schema defaults are not filled on the skipped path", async () => {
    const { calls, transport } = recordingTransport();
    const config = { transport, wallet };

    // `grouping` defaults to "na" in the schema; the validated path fills it in...
    await order(config, { orders: [LIMIT_ORDER] });
    assertEquals((calls[0] as { action: Record<string, unknown> }).action.grouping, "na");

    // ...while the skipped path posts the action exactly as given (no default-filling).
    await order(config, { orders: [LIMIT_ORDER] }, { skipValidation: true });
    assert(!("grouping" in (calls[1] as { action: Record<string, unknown> }).action));
  });

  test("default behavior is unchanged: validation still runs without the flag", () => {
    const { transport } = recordingTransport();
    const config = { transport, wallet };

    assertThrows(() => order(config, { orders: [] }), ValidationError); // empty batch
    assertThrows(
      () => order(config, { orders: [{ ...LIMIT_ORDER, p: "0" }], grouping: "na" }),
      ValidationError, // zero price
    );
  });
});
