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

import { HttpTransport, WebSocketTransport } from "@bloxwap/hyperliquid";
import { scenario } from "../_harness.ts";
import { installMockWebSocket, lastMockWebSocket, type MockWebSocket, restoreWebSocket } from "../_helpers.ts";

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
function httpContext(): HttpContext {
  const originalFetch = globalThis.fetch;
  const served = { count: 0 };
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    served.count++;
    return Promise.resolve(new Response(SMALL_BODY, { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof globalThis.fetch;

  return { transport: new HttpTransport(), originalFetch, served };
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
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
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
