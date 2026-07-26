/**
 * Integration tests for WebSocketTransport against a local WebSocket server
 * speaking the happy-path Hyperliquid protocol.
 * @module
 */

import { afterAll, beforeAll, describe, test } from "bun:test";
import { getEventListeners } from "node:events";
import type { Server, ServerWebSocket } from "bun";
import { assert, assertEquals, assertLess, assertRejects } from "@jsr/std__assert";
import { WebSocketRequestError, WebSocketTransport } from "@bloxwap/hyperliquid";

// =============================================================================
// Helpers
// =============================================================================

/** The test server carries no per-socket state. */
type TestServer = Server<undefined>;

/** WebSocketTransport that closes itself at the end of an `await using` block. */
class DisposeWebSocketTransport extends WebSocketTransport {
  [Symbol.asyncDispose](): Promise<void> {
    this.close();
    return Promise.resolve();
  }
}

/** Creates a transport connected to the test server. */
function createTransport(url: string): DisposeWebSocketTransport {
  return new DisposeWebSocketTransport({ url });
}

// =============================================================================
// Test Server
// =============================================================================

/** Serves the happy-path Hyperliquid protocol on an ephemeral port. */
function createTestServer(): TestServer {
  return Bun.serve({
    port: 0,
    fetch(request, server): Response | undefined {
      // `upgrade()` returning true means the response is owned by the WebSocket handler below.
      if (server.upgrade(request)) return undefined;
      return new Response(null, { status: 501 });
    },
    websocket: {
      message(socket: ServerWebSocket, message: string | Buffer): void {
        const send = (payload: unknown) => socket.send(JSON.stringify(payload));
        const data = JSON.parse(message.toString());

        if (data.method === "post") {
          send({
            channel: "post",
            data: { id: data.id, response: { type: "info", payload: { data: `response:${data.request.type}` } } },
          });
        } else if (data.method === "ping") {
          send({ channel: "pong" });
        } else if (data.method === "drop") {
          socket.close();
        } else if (data.method === "subscribe") {
          send({
            channel: "subscriptionResponse",
            data: { method: "subscribe", subscription: data.subscription },
          });

          const eventChannel = (data.subscription && data.subscription.channel) || "test-channel";
          send({ channel: eventChannel, data: { update: "subscription update" } });
        } else if (data.method === "unsubscribe") {
          send({
            channel: "subscriptionResponse",
            data: { method: "unsubscribe", subscription: data.subscription },
          });
        }
      },
    },
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("WebSocketTransport", () => {
  let server: TestServer;
  let url: string;

  beforeAll(() => {
    server = createTestServer();
    url = `ws://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.stop(true);
  });

  test("request() sends request and receives response", async () => {
    await using transport = createTransport(url);
    await transport.ready();

    const result = await transport.request("info", { key: "value" });
    assertEquals(result, "response:info");
  });

  test("request() wraps the exchange endpoint as an action envelope", async () => {
    await using transport = createTransport(url);
    await transport.ready();

    const result = await transport.request("exchange", { key: "value" });
    assertEquals(result, "response:action");
  });

  test("subscription() subscribes, receives event, unsubscribes", async () => {
    await using transport = createTransport(url);
    await transport.ready();

    const channel = "test-channel";
    const payload = { channel, foo: "bar" };

    let received: unknown;
    const { promise: eventPromise, resolve } = Promise.withResolvers<void>();
    const subscription = await transport.subscribe(channel, payload, (e) => {
      received = e.detail;
      resolve();
    });
    await eventPromise;

    assertEquals(received, { update: "subscription update" });

    await subscription.unsubscribe();
  });

  describe("ready()", () => {
    test("resolves immediately if already open", async () => {
      await using transport = createTransport(url);
      await transport.ready();

      const start = performance.now();
      await transport.ready();
      assertLess(performance.now() - start, 20);
    });

    test("rejects if already aborted", async () => {
      await using transport = createTransport(url);

      const signal = AbortSignal.abort(new Error("Already aborted"));
      const error = await assertRejects(
        () => transport.ready(signal),
        WebSocketRequestError,
        "Waiting for the connection was aborted",
      );
      assertEquals(error.cause, signal.reason);
    });

    test("rejects if aborted later", async () => {
      await using transport = createTransport(url);

      const controller = new AbortController();
      const promise = transport.ready(controller.signal);
      controller.abort(new Error("Aborted later"));

      const error = await assertRejects(() => promise, WebSocketRequestError, "Waiting for the connection was aborted");
      assertEquals(error.cause, controller.signal.reason);
    });

    test("rejects if connection is closed", async () => {
      await using transport = createTransport(url);
      transport.close();

      const error = await assertRejects(
        () => transport.ready(),
        WebSocketRequestError,
        "Failed to establish WebSocket connection",
      );
      assertEquals(error.cause, transport.socket.terminationSignal.reason);
    });

    test("detaches its listeners once settled", async () => {
      await using transport = createTransport(url);

      const terminationBaseline = getEventListeners(transport.socket.terminationSignal, "abort").length;
      const openBaseline = getEventListeners(transport.socket, "open").length;

      const controller = new AbortController();
      await Promise.all(Array.from({ length: 100 }, () => transport.ready(controller.signal)));

      assertEquals(getEventListeners(transport.socket.terminationSignal, "abort").length, terminationBaseline);
      assertEquals(getEventListeners(transport.socket, "open").length, openBaseline);
    });
  });

  describe("close()", () => {
    test("is idempotent", async () => {
      await using transport = createTransport(url);
      await transport.ready();

      transport.close();
      transport.close();
      assert(transport.socket.terminationSignal.aborted);
    });

    test("terminates when called from a close listener", async () => {
      await using transport = createTransport(url);
      await transport.ready();

      const { promise: dropped, resolve } = Promise.withResolvers<void>();
      transport.socket.addEventListener(
        "close",
        () => {
          transport.close();
          resolve();
        },
        { once: true },
      );

      transport.socket.send('{"method":"drop"}');
      await dropped;
      assert(transport.socket.terminationSignal.aborted);
    });
  });
});
