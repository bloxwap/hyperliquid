/**
 * Tests for the pre-signed payload helpers (`prepareRequest` / `submitPrepared`): sign-now,
 * submit-later round-trips, nonce consumption at prepare time, both transports, and the
 * robustness rules of the capture transport (endpoint check, record-first attempt tracking,
 * settlement, and poison-on-late-attempt).
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@jsr/std__assert";
import { HyperliquidError, type IRequestTransport, WebSocketTransport } from "@bloxwap/hyperliquid";
import {
  type ExchangeConfig,
  order,
  type OrderParameters,
  type OrderSuccessResponse,
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

/**
 * A viem-local-shaped wallet whose `sign`/`signTypedData` return a fixed signature without
 * touching the curve — secp256k1 (~100+ µs) would otherwise dominate the timing-regression test.
 */
const stubWallet = {
  address: "0x1111111111111111111111111111111111111111" as const,
  sign: (_args: { hash: `0x${string}` }) => Promise.resolve(`0x${"11".repeat(64)}1b` as `0x${string}`),
  signTypedData: (_params: unknown) => Promise.resolve(`0x${"11".repeat(64)}1b` as `0x${string}`),
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
    assertEquals(submitted.status, "ok");
    assertEquals(submitted.response.type, "order");
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

    // The exchange tracks the 100 highest nonces per user, so the earlier prepared payload is
    // NOT invalidated by the later request above — it would only go stale after 100 newer nonces
    // were consumed. Submission with the older nonce is still accepted (mock server here; on a
    // real server it is accepted while the nonce stays in the 100-highest window).
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

  test("requests to non-exchange endpoints are rejected, naming the endpoint", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };

    const error = await assertRejects(
      () => prepareRequest(config, (c) => c.transport.request("info", { type: "allMids" })),
      HyperliquidError,
      'the "info" endpoint',
    );
    assert(error.message.includes('only "exchange" requests can be prepared'));
  });

  test("a swallowed non-exchange rejection still fails the prepare", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };

    // The callback try/catches the endpoint rejection, then issues one clean exchange call.
    // The invalid attempt was recorded BEFORE the rejection was delivered, so the prepare
    // fails anyway at final validation.
    await assertRejects(
      () =>
        prepareRequest(config, async (c) => {
          await c.transport.request("info", { type: "allMids" }).catch(() => undefined); // swallowed
          await order(c, PARAMS);
        }),
      HyperliquidError,
      "more than one request",
    );
  });

  test("an un-awaited attempt arriving before the callback settles fails the prepare", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };

    // The floating attempt is fired first and wins the per-wallet lock race, so the awaited
    // second attempt reaches the capture transport after it — still before the callback
    // settles — where it is recorded and rejected; the rejection propagates through the callback.
    await assertRejects(
      () =>
        prepareRequest(config, async (c) => {
          void order(c, PARAMS).catch(() => undefined); // floating: captures first
          await order(c, PARAMS); // arrives second → invalid → rejects → run() rejects
        }),
      HyperliquidError,
      "more than one request",
    );
  });

  test("an un-awaited attempt fired as the callback returns poisons the payload", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };

    // The actual guaranteed window, precisely: a floating attempt fired as the callback's last
    // synchronous statement does NOT arrive before settle — its path to the capture transport
    // spans several microtasks (address, lock, nonce, signing) while the settle continuation
    // runs on the first — so the prepare succeeds and the attempt takes the poison path.
    const prepared = await prepareRequest(config, async (c) => {
      await order(c, PARAMS);
      void order(c, PARAMS).catch(() => undefined);
    });
    assert(prepared.nonce > 0);

    await new Promise((r) => setTimeout(r, 30)); // let the late attempt land
    await assertRejects(
      () => submitPrepared(config, prepared),
      HyperliquidError,
      "poisoned by a request attempted after it was produced",
    );
  });

  test("a request attempted after settle gets a rejected promise of its own", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };
    let lateAttempt: Promise<unknown> | undefined;

    const prepared = await prepareRequest(config, async (c) => {
      await order(c, PARAMS);
      // Leaked work: fires only after prepareRequest has settled (a programming error).
      setTimeout(() => {
        lateAttempt = order(c, PARAMS).then(
          () => null,
          (e: unknown) => e,
        );
      }, 5);
    });

    assert(prepared.nonce > 0); // prepare already returned — its result stands

    // The late attempt's rejection is delivered to ITS promise, where the leaker can observe it.
    // (A fire-and-forget `void` leak that discards the promise would reject unobserved — an
    // unhandledRejection by definition, which is the leaker's responsibility, not the SDK's.)
    await new Promise((r) => setTimeout(r, 30));
    assert(lateAttempt !== undefined);
    const error = await lateAttempt;
    assert(error instanceof HyperliquidError);
    assert(error.message.includes("after the prepare callback settled"));
  });

  test("a void (fire-and-forget) leaked attempt still rejects its own promise when observed", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };
    let leakedConfig: ExchangeConfig | undefined;
    let observed: Promise<unknown> | undefined;

    const prepared = await prepareRequest(config, async (c) => {
      leakedConfig = c;
      await order(c, PARAMS);
    });
    assert(prepared.nonce > 0);

    // The hazardous shape is `void order(...)` with NO observer anywhere — a discarded promise
    // rejects unobserved (an unhandledRejection the leaker owns; the SDK delivers the rejection
    // to the promise, it cannot force anyone to look at it). Here we attach an observer at
    // creation but read it only after the rejection settled, verifying the rejection VALUE is
    // delivered to the attempt's own promise.
    setTimeout(() => {
      observed = order(leakedConfig!, PARAMS).then(
        () => null,
        (e: unknown) => e,
      );
    }, 5);
    await new Promise((r) => setTimeout(r, 30));

    assert(observed !== undefined);
    const error: unknown = await observed;
    assert(error instanceof HyperliquidError);
    assert(error.message.includes("after the prepare callback settled"));
  });

  test("a delayed floating attempt poisons the payload: submitPrepared rejects it", async () => {
    const { calls, transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };
    let leakedConfig: ExchangeConfig | undefined;

    const prepared = await prepareRequest(config, async (c) => {
      leakedConfig = c; // leak the capture config, as forgotten callback work would hold it
      await order(c, PARAMS);
    });

    // The attempt BEGINS only after prepareRequest resolved (~5 ms later), so it cannot be
    // caught at prepare time. It must poison the payload instead; the poison flag is re-checked
    // synchronously at submit time, immediately before posting.
    setTimeout(() => {
      void order(leakedConfig!, PARAMS).catch(() => undefined);
    }, 5);
    await new Promise((r) => setTimeout(r, 30));

    await assertRejects(
      () => submitPrepared(config, prepared),
      HyperliquidError,
      "poisoned by a request attempted after it was produced",
    );
    assertEquals(calls.length, 0); // nothing was ever posted
  });

  test("the prepared payload carries the wrapped method's response type", async () => {
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet };

    const prepared = await prepareRequest(config, (c) => order(c, PARAMS));
    const response = await submitPrepared(config, prepared);

    // Compile-time check (enforced by the tsc gate): the response is inferred as
    // OrderSuccessResponse, not unknown.
    const typed: OrderSuccessResponse = response;
    assertEquals(typed.status, "ok");
    assertEquals(typed.response.type, "order");
  });

  test("a minimal prepare completes in well under 1 ms (no macrotask drain)", async () => {
    // Rationale: prepareRequest once drained one task tick (`setTimeout(0)`) per call to widen
    // the exactly-one window, which costs ~1.2 ms per prepare (macrotask clamping) — a ~40-150×
    // regression the contract does not need. The drain was removed; this test fails if it comes
    // back. Honest prepare work (stub wallet, so secp256k1 is off the clock) is tens of µs; the
    // 200 µs median bar is ~6× above that, so it cannot flake on a loaded CI runner but still
    // catches any macrotask wait (~1.2 ms).
    const { transport } = recordingTransport();
    const config: ExchangeConfig = { transport, wallet: stubWallet };

    const durations: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      await prepareRequest(config, (c) => order(c, PARAMS));
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    const median = durations[durations.length >> 1];
    assert(
      median < 0.2,
      `median prepare took ${(median * 1000).toFixed(0)} µs — a macrotask drain (~1.2 ms) may have been reintroduced`,
    );
  });
});
