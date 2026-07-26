/**
 * Tests for the pre-signed payload helpers (`prepareRequest` / `submitPrepared`): sign-now,
 * submit-later round-trips, nonce consumption at prepare time, and both transports.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@jsr/std__assert";
import { HyperliquidError, type IRequestTransport, WebSocketTransport } from "@bloxwap/hyperliquid";
import {
  type ExchangeConfig,
  order,
  type OrderParameters,
  prepareRequest,
  submitPrepared,
} from "@bloxwap/hyperliquid/api/exchange";
import { privateKeyToAccount } from "viem/accounts";
import { installMockWebSocket, lastMockWebSocket, restoreWebSocket } from "../../perf/_helpers.ts";

const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

const ORDER_SUCCESS = {
  status: "ok",
  response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } },
} as const;

const PARAMS: OrderParameters = {
  orders: [{ a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
};

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

describe("prepareRequest + submitPrepared", () => {
  test("prepare → submit round-trip produces the same wire body as the direct call", async () => {
    const { calls, transport } = recordingTransport();
    // Fixed nonce so the two payloads are comparable byte-for-byte (the signature commits to it).
    const config: ExchangeConfig = { transport, wallet, nonceManager: () => 1700000000000 };

    await order(config, PARAMS);
    const prepared = await prepareRequest(config, (c) => order(c, PARAMS));
    const submitted = await submitPrepared(config, prepared);

    assertEquals(calls.length, 2); // prepare itself posted nothing
    // Identical wire body (action, signature, nonce). Compared as JSON — the actual wire format —
    // because the direct payload carries `vaultAddress`/`expiresAfter` as explicit `undefined`
    // (the shell spreads them unconditionally), which JSON omits.
    assertEquals(JSON.parse(JSON.stringify(calls[1])), JSON.parse(JSON.stringify(calls[0])));
    assertEquals(calls[1], prepared); // submit posts the prepared payload as-is
    assertEquals(submitted, ORDER_SUCCESS);
    assertEquals(prepared.nonce, 1700000000000);
    assertEquals((prepared.action as Record<string, unknown>).type, "order");
    assertEquals(typeof prepared.signature.r, "string");
  });

  test("the nonce is consumed at prepare time; a later request gets a later nonce", async () => {
    const { calls, transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet }; // default monotonic nonce manager

    const prepared = await prepareRequest(config, (c) => order(c, PARAMS));
    assertEquals(calls.length, 0); // nothing was sent, but the nonce was consumed

    await order(config, PARAMS);
    const directNonce = (calls[0] as { nonce: number }).nonce;
    assert(prepared.nonce < directNonce, `prepared nonce ${prepared.nonce} should precede ${directNonce}`);

    // Documented staleness: the prepared payload goes stale once the server has seen a later
    // nonce from this wallet. Submission itself is still allowed (the mock server accepts it);
    // on a real server it would be rejected with a stale-nonce error.
    await submitPrepared(config, prepared);
    assertEquals((calls[1] as { nonce: number }).nonce, prepared.nonce);
  });

  test("works over WebSocketTransport", async () => {
    installMockWebSocket();
    const transport = new WebSocketTransport({ isTestnet: true });
    try {
      const config: ExchangeConfig = { transport, wallet };

      const prepared = await prepareRequest(config, (c) => order(c, PARAMS));
      await submitPrepared(config, prepared);

      const frames = lastMockWebSocket().sentMessages.map((m) => JSON.parse(m) as Record<string, unknown>);
      const posts = frames.filter((f) => f.method === "post");
      assertEquals(posts.length, 1); // prepare sent nothing; submit sent exactly one frame
      assertEquals((posts[0].request as Record<string, unknown>).type, "action");
      assertEquals((posts[0].request as Record<string, unknown>).payload, prepared);
    } finally {
      transport.close();
      restoreWebSocket();
    }
  });

  test("works over WebSocketTransport via the client methods", async () => {
    const { ExchangeClient } = await import("@bloxwap/hyperliquid");
    installMockWebSocket();
    const transport = new WebSocketTransport({ isTestnet: true });
    try {
      const client = new ExchangeClient({ transport, wallet });

      const prepared = await client.prepareRequest((c) => order(c, PARAMS));
      await client.submitPrepared(prepared);

      const frames = lastMockWebSocket().sentMessages.map((m) => JSON.parse(m) as Record<string, unknown>);
      const posts = frames.filter((f) => f.method === "post");
      assertEquals(posts.length, 1);
      assertEquals((posts[0].request as Record<string, unknown>).payload, prepared);
    } finally {
      transport.close();
      restoreWebSocket();
    }
  });

  test("the callback must issue exactly one request", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };

    await assertRejects(
      () => prepareRequest(config, () => Promise.resolve()),
      HyperliquidError,
      "did not issue a request",
    );
    await assertRejects(
      () =>
        prepareRequest(config, async (c) => {
          await order(c, PARAMS);
          await order(c, PARAMS);
        }),
      HyperliquidError,
      "more than one request",
    );
  });
});
