/**
 * Per-request transport overhead, with the network removed.
 *
 * `HttpTransport` runs against a stubbed `globalThis.fetch` and `WebSocketTransport` against
 * {@linkcode MockWebSocket}, so what remains is exactly the SDK's own work: payload encode,
 * endpoint URL resolution, abort/timeout wiring, response decode, and — for the WebSocket —
 * queueing the frame and matching the response back to its pending request.
 *
 * Both stubs answer immediately, so the reported time is a per-request floor: whatever the
 * SDK adds on top of a zero-latency link. Payloads are deliberately small; the cost of large
 * bodies is the `data` group's job.
 *
 * Every scenario restores the global it replaced in `teardown`, so scenario order never
 * changes a result.
 * @module
 */

import { ExchangeClient, HttpTransport, WebSocketQuota, WebSocketTransport } from "@bloxwap/hyperliquid";
import { buildOrder } from "@bloxwap/hyperliquid/actions";
import { privateKeyToAccount } from "viem/accounts";
import { scenario } from "../_harness.ts";
import {
  installMockWebSocket,
  lastMockWebSocket,
  type MockWebSocket,
  ORDER_SUCCESS,
  restoreWebSocket,
  TEST_PRIVATE_KEY,
} from "../_helpers.ts";

/** A minimal `allMids` body — small on purpose, so decode cost does not dominate. */
const SMALL_BODY = JSON.stringify({ BTC: "97000.0", ETH: "3400.5" });

interface HttpContext {
  transport: HttpTransport;
  /** The `fetch` implementation replaced at setup, restored in teardown. */
  originalFetch: typeof globalThis.fetch;
  /** Requests the stub answered, so a scenario that silently short-circuits is detectable. */
  served: { count: number };
}

/**
 * Installs a `fetch` stub that answers every request with {@linkcode SMALL_BODY}.
 *
 * The stub builds a real `Response`, because that is what the transport consumes
 * (`headers.get`, `text()`); its construction cost is a constant included in every sample.
 */
function httpContext(transport = new HttpTransport(), responseBody = SMALL_BODY): HttpContext {
  const originalFetch = globalThis.fetch;
  const served = { count: 0 };
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    served.count++;
    return Promise.resolve(
      new Response(responseBody, { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  }) as typeof globalThis.fetch;

  return { transport, originalFetch, served };
}

/** Restores the `fetch` implementation the scenario replaced. */
function restoreFetch({ originalFetch, served }: HttpContext): void {
  globalThis.fetch = originalFetch;
  if (served.count === 0) throw new Error("fetch stub was never called: the scenario measured nothing");
}

// --- HTTP -----------------------------------------------------------------

scenario({
  name: "transport/http_request",
  group: "transport",
  description: "HttpTransport.request() against a stubbed fetch (encode + URL + timeout wiring + decode)",
  unit: "request",
  iterations: 200,
  // 25 samples rather than the default: this scenario produced a spurious +35% regression on a
  // change that touched no transport code. The median is robust to outliers, so the fix is more
  // samples, not more iterations per sample -- longer samples let GC pauses land inside them and
  // measurably WIDENED the spread when tried (rme 5% -> 20%).
  samples: 25,
  setup: httpContext,
  run: async ({ transport }: HttpContext) => {
    await transport.request("info", { type: "allMids" });
  },
  teardown: restoreFetch,
});

// A user-supplied signal is the common case for cancellable reads, and it is the only case
// that builds an abort relay on top of the per-request timeout. Measured separately so the
// relay's cost is attributable rather than folded into the baseline request cost.

scenario({
  name: "transport/http_request_with_signal",
  group: "transport",
  description: "HttpTransport.request() with a caller AbortSignal, so the abort relay is wired per request",
  unit: "request",
  iterations: 200,
  // 25 samples rather than the default: this scenario produced a spurious +35% regression on a
  // change that touched no transport code. The median is robust to outliers, so the fix is more
  // samples, not more iterations per sample -- longer samples let GC pauses land inside them and
  // measurably WIDENED the spread when tried (rme 5% -> 20%).
  samples: 25,
  setup: (): HttpContext & { controller: AbortController } => ({
    ...httpContext(),
    // One long-lived controller: a fresh AbortController per call would measure its
    // construction rather than the relay the transport attaches to it.
    controller: new AbortController(),
  }),
  run: async ({ transport, controller }: HttpContext & { controller: AbortController }) => {
    await transport.request("info", { type: "allMids" }, controller.signal);
  },
  teardown: restoreFetch,
});

// --- HTTP, rate-limited ------------------------------------------------------
// The opt-in token bucket, sized so it never empties: what remains is the per-request billing
// cost itself — computing the weight (verified against the wire string, no JSON round-trip)
// and the bucket bookkeeping.

/** A bucket that never waits: the refill dwarfs anything a sample can spend. */
function rateLimitedContext(): HttpContext {
  return httpContext(new HttpTransport({ rateLimit: { capacity: 1_000_000_000, refillPerMinute: 1_000_000_000 } }));
}

scenario({
  name: "transport/http_request_rate_limited",
  group: "transport",
  description: "HttpTransport.request() with the rate limiter enabled (weight billing only; the bucket never waits)",
  unit: "request",
  iterations: 200,
  samples: 25, // see transport/http_request for why 25
  setup: rateLimitedContext,
  run: async ({ transport }: HttpContext) => {
    await transport.request("info", { type: "allMids" });
  },
  teardown: restoreFetch,
});

// ~5 KB info body: billing used to parse the whole wire string to read one `type`, so a large
// body is where the verified-type fast path diverges from the old JSON round-trip. The payload
// is built once — the transport never mutates it — so only the per-request cost is measured.

/** A ~5 KB `userFillsByTime` request: a realistic small head plus a sizeable array field. */
const LARGE_INFO_PAYLOAD = {
  type: "userFillsByTime",
  user: "0x0000000000000000000000000000000000000001",
  startTime: 1_700_000_000_000,
  aggregateByTime: false,
  filter: Array.from({ length: 100 }, (_, i) => ({ coin: `COIN${i}`, tid: i * 1_000_003 })),
};

scenario({
  name: "transport/http_request_rate_limited_large_info",
  group: "transport",
  description:
    "HttpTransport.request() rate-limited, with a ~5 KB info body (weight verification vs a full wire-body parse)",
  unit: "request",
  iterations: 200,
  samples: 25, // see transport/http_request for why 25
  setup: rateLimitedContext,
  run: async ({ transport }: HttpContext) => {
    await transport.request("info", LARGE_INFO_PAYLOAD);
  },
  teardown: restoreFetch,
});

// A 100-order batch through ExchangeClient over the rate-limited HttpTransport (~8 KB wire
// body). One ECDSA signature per batch is included, so the figures are per order, like
// transaction/order_batch_100. `client.order()` sends an envelope the wire registry does not
// know, so billing still parses the wire body; `client.execute(buildOrder(...))` sends an
// SDK-registered canonical envelope, which billing walks directly without the parse.

/** ExchangeClient over a never-waiting, rate-limited HttpTransport answering ORDER_SUCCESS. */
function rateLimitedExchangeContext(): HttpContext & { client: ExchangeClient } {
  const context = httpContext(
    new HttpTransport({ isTestnet: true, rateLimit: { capacity: 1_000_000_000, refillPerMinute: 1_000_000_000 } }),
    JSON.stringify(ORDER_SUCCESS),
  );
  const client = new ExchangeClient({ transport: context.transport, wallet: privateKeyToAccount(TEST_PRIVATE_KEY) });
  return { ...context, client };
}

scenario({
  name: "transport/http_order_batch_100_rate_limited",
  group: "transport",
  description: "ExchangeClient.order() with 100 orders over a rate-limited HttpTransport (stubbed fetch), per order",
  unit: "order",
  unitsPerIteration: 100,
  iterations: 10,
  samples: 10,
  setup: rateLimitedExchangeContext,
  run: async ({ client }: HttpContext & { client: ExchangeClient }) => {
    await client.order({
      orders: Array.from({ length: 100 }, (_, i) => ({
        a: i % 200,
        b: i % 2 === 0,
        p: "30000",
        s: "0.001",
        r: false,
        t: { limit: { tif: "Gtc" as const } },
      })),
      grouping: "na",
    });
  },
  teardown: restoreFetch,
});

scenario({
  name: "transport/http_execute_order_batch_100_rate_limited",
  group: "transport",
  description:
    "ExchangeClient.execute(buildOrder()) with 100 orders over a rate-limited HttpTransport (stubbed fetch), per order",
  unit: "order",
  unitsPerIteration: 100,
  iterations: 10,
  samples: 10,
  setup: rateLimitedExchangeContext,
  run: async ({ client }: HttpContext & { client: ExchangeClient }) => {
    await client.execute(
      buildOrder({
        orders: Array.from({ length: 100 }, (_, i) => ({
          a: i % 200,
          b: i % 2 === 0,
          p: "30000",
          s: "0.001",
          r: false,
          t: { limit: { tif: "Gtc" as const } },
        })),
        grouping: "na",
      }),
    );
  },
  teardown: restoreFetch,
});

// --- WebSocket ------------------------------------------------------------
// A `post` round trip: envelope + id, frame encode, queue insert, response decode, and the
// id match that resolves the caller's promise. The mock answers on a microtask, so the
// measured cost excludes the link and includes everything the dispatcher does.

interface WsContext {
  transport: WebSocketTransport;
  socket: MockWebSocket;
}

scenario({
  name: "transport/ws_request_round_trip",
  group: "transport",
  description: "WebSocketTransport.request() round trip through the dispatcher against a mock socket",
  unit: "request",
  iterations: 200,
  // The async round trip needs more warmup than the default: it keeps tiering up for about
  // six samples (~9 µs -> ~3 µs per request), and measuring that ramp is measuring the JIT.
  warmupSamples: 6,
  // The allocation-heavy path (envelope, frame, pending entry, promise, parsed response per
  // request) draws a major GC into roughly one sample per run, worth ~5x the median. Extra
  // samples cannot prevent that pause, but they keep it from dominating the reported spread.
  samples: 25,
  setup: async (): Promise<WsContext> => {
    installMockWebSocket();
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws", quota: new WebSocketQuota() });
    await transport.ready();
    const socket = lastMockWebSocket();
    socket.postData = JSON.parse(SMALL_BODY);
    return { transport, socket };
  },
  run: async ({ transport }: WsContext) => {
    await transport.request("info", { type: "allMids" });
  },
  teardown: ({ transport }: WsContext) => {
    transport.close();
    restoreWebSocket();
  },
});
