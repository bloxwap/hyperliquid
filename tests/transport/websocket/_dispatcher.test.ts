/**
 * Tests for the WebSocket request dispatcher: request/response matching,
 * server error parsing, and queueing across reconnects.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import { ReconnectingWebSocket } from "../../../src/transport/websocket/_reconnectingSocket.ts";
import { WebSocketDispatcher, WebSocketRequestError } from "../../../src/transport/websocket/_dispatcher.ts";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";
import { drain, getLastSent, MockWebSocket, RESPONSES } from "./_mock.ts";
import { requestToId } from "../../../src/transport/websocket/_id.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Creates a new WebSocketDispatcher with mock socket. */
function createRequester(timeout: number | null = 10_000): {
  socket: MockWebSocket;
  requester: WebSocketDispatcher;
} {
  const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
  const hlEvents = new HyperliquidEventTarget(socket);
  const requester = new WebSocketDispatcher(socket, hlEvents, timeout);
  return { socket, requester };
}

// =============================================================================
// Tests
// =============================================================================

describe("WebSocketDispatcher", () => {
  describe("request()", () => {
    describe("post", () => {
      test("sends request and receives info response", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { foo: "bar" });
        const sent = getLastSent(socket);

        assertEquals(sent.method, "post");
        assertEquals(typeof sent.id, "number");
        assertEquals((sent.request as Record<string, unknown>).foo, "bar");

        socket.mockMessage(RESPONSES.info(sent.id as number, "TestData"));
        assertEquals(await promise, "TestData");
      });

      test("concurrent posts each resolve with the response carrying their id", async () => {
        const { socket, requester } = createRequester();

        const promises = [0, 1, 2].map(() => requester.request("post", { foo: "bar" }));
        const ids = socket.sentMessages.map((frame) => JSON.parse(frame).id as number);

        // Answered out of order: matching is by id, not by arrival.
        for (const id of [...ids].reverse()) socket.mockMessage(RESPONSES.info(id, `data-${id}`));

        assertEquals(
          await Promise.all(promises),
          ids.map((id) => `data-${id}`),
        );
      });

      test("receives action response", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: "action" });
        const sent = getLastSent(socket);

        const payload = { status: "ok", response: { type: "order", data: { statuses: ["filled"] } } };
        socket.mockMessage(RESPONSES.action(sent.id as number, payload));
        assertEquals(await promise, payload);
      });

      test("rejects on error response", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        socket.mockMessage(RESPONSES.error(sent.id as number, "Operation failed"));
        const err = await assertRejects(() => promise, WebSocketRequestError, "Operation failed");
        assertEquals((err as WebSocketRequestError).request, { test: true });
      });

      test("error carries a redacted copy of a signed payload; the frame keeps the real signature", async () => {
        const { socket, requester } = createRequester();
        const signedPayload = {
          action: { type: "order", orders: [{ a: 0, b: true }] },
          signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 },
          nonce: 12345,
        };

        const promise = requester.request("post", signedPayload);
        const sent = getLastSent(socket);
        assertEquals(sent.request, signedPayload); // the wire keeps the real signature

        socket.mockMessage(RESPONSES.error(sent.id as number, "Operation failed"));
        const err = await assertRejects(() => promise, WebSocketRequestError, "Operation failed");
        const redacted = (err as WebSocketRequestError).request as Record<string, unknown>;
        assertEquals(redacted.signature, "0x<redacted>");
        assertEquals(redacted.action, signedPayload.action);
        assertEquals(signedPayload.signature.v, 27); // the caller's object was never mutated
      });

      test("rejects on error channel", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        socket.mockMessage(RESPONSES.errorChannel(`Something failed: {"id":${sent.id}}`));
        await assertRejects(() => promise, WebSocketRequestError);
      });

      test("rejects by the trailing id of a body-less error", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        socket.mockMessage(RESPONSES.errorChannel(`too many pending post requests id=${sent.id}`));
        await assertRejects(() => promise, WebSocketRequestError, "too many pending post requests");
      });

      test("ignores a response with an unknown id", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { foo: "bar" });
        const sent = getLastSent(socket);

        // Not ours: neither settles the pending request nor disturbs its later match.
        socket.mockMessage(RESPONSES.info(999_999, "stray"));
        socket.mockMessage(RESPONSES.info(sent.id as number, "mine"));
        assertEquals(await promise, "mine");
      });

      test("rejects a response without a `response` field instead of hanging", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        // Previously `detail.response.type` threw out of the guarded listener and the
        // request hung until the timeout.
        socket.mockMessage({ channel: "post", data: { id: sent.id } });
        await assertRejects(() => promise, WebSocketRequestError, "Malformed post response");
      });

      test("an info response without data rejects instead of resolving undefined (upstream nktkas#50)", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        // The upstream bug class: the request resolved `undefined`, surfacing as a
        // confusing TypeError deep in the exchange client instead of a rejection.
        socket.mockMessage({
          channel: "post",
          data: { id: sent.id, response: { type: "info", payload: { type: "allMids" } } },
        });
        await assertRejects(() => promise, WebSocketRequestError, "Malformed post response");
      });

      test("rejects an action response without a payload instead of resolving undefined", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        socket.mockMessage({ channel: "post", data: { id: sent.id, response: { type: "action" } } });
        await assertRejects(() => promise, WebSocketRequestError, "Malformed post response");
      });

      test("rejects an action payload whose nested response is missing", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        // The payload exists but carries no usable inner {status, response}: resolving it
        // would hand `undefined` to the exchange client one level deeper (nktkas#50 class).
        socket.mockMessage({
          channel: "post",
          data: { id: sent.id, response: { type: "action", payload: { status: "ok" } } },
        });
        await assertRejects(() => promise, WebSocketRequestError, "Malformed post response");
      });

      test("rejects an action payload whose nested response has the wrong shape", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        socket.mockMessage({
          channel: "post",
          data: { id: sent.id, response: { type: "action", payload: { status: "ok", response: 42 } } },
        });
        await assertRejects(() => promise, WebSocketRequestError, "Malformed post response");
      });

      test("rejects a response with an unknown type", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        socket.mockMessage({
          channel: "post",
          data: { id: sent.id, response: { type: "mystery", payload: { data: "x" } } },
        });
        await assertRejects(() => promise, WebSocketRequestError, 'Unknown post response type "mystery"');
      });

      test("rejects an error response whose payload is not a string", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("post", { test: true });
        const sent = getLastSent(socket);

        socket.mockMessage({
          channel: "post",
          data: { id: sent.id, response: { type: "error", payload: { code: 1 } } },
        });
        await assertRejects(() => promise, WebSocketRequestError, "Malformed post response");
      });
    });

    describe("subscribe/unsubscribe", () => {
      test("sends subscription and receives response", async () => {
        const { socket, requester } = createRequester();
        const payload = { channel: "test-sub", param: "XYZ" };

        const promise = requester.request("subscribe", payload);
        const sent = getLastSent(socket);
        assertEquals(sent.method, "subscribe");

        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        const result = (await promise) as Record<string, unknown>;
        assertEquals(result.method, "subscribe");
        assertEquals(result.subscription, payload);
      });

      test("rejects on subscription error", async () => {
        const { socket, requester } = createRequester();
        const payload = { channel: "test", param: "test" };

        const promise = requester.request("subscribe", payload);
        const errorMsg = `Something failed: {"method":"subscribe","subscription":${JSON.stringify(payload)}}`;

        socket.mockMessage(RESPONSES.errorChannel(errorMsg));
        await assertRejects(() => promise, WebSocketRequestError, errorMsg);
      });

      test("rejects on Already subscribed", async () => {
        const { socket, requester } = createRequester();
        const payload = { channel: "test", param: "test" };

        const promise = requester.request("subscribe", payload);
        const errorMsg = `Already subscribed: ${JSON.stringify(payload)}`;

        socket.mockMessage(RESPONSES.errorChannel(errorMsg));
        await assertRejects(() => promise, WebSocketRequestError, errorMsg);
      });

      test("rejects when the echo carries server-added fields", async () => {
        const { socket, requester } = createRequester();
        const payload = { type: "userFills", user: "0xabc" };

        const promise = requester.request("subscribe", payload);
        const echoed = JSON.stringify({ type: "userFills", user: "0xabc", aggregateByTime: false });

        socket.mockMessage(RESPONSES.errorChannel(`Already subscribed: ${echoed}`));
        await assertRejects(() => promise, WebSocketRequestError, "Already subscribed");
      });

      test("rejects on Invalid subscription", async () => {
        const { socket, requester } = createRequester();
        const payload = { channel: "invalid", param: "test" };

        const promise = requester.request("subscribe", payload);
        const errorMsg = `Invalid subscription ${JSON.stringify(payload)}`;

        socket.mockMessage(RESPONSES.errorChannel(errorMsg));
        await assertRejects(() => promise, WebSocketRequestError, errorMsg);
      });

      test("rejects on Already unsubscribed", async () => {
        const { socket, requester } = createRequester();
        const payload = { channel: "test", param: "test" };

        const promise = requester.request("unsubscribe", payload);
        const errorMsg = `Already unsubscribed: ${JSON.stringify(payload)}`;

        socket.mockMessage(RESPONSES.errorChannel(errorMsg));
        await assertRejects(() => promise, WebSocketRequestError, errorMsg);
      });

      test("a burst of subscriptions each resolves with its own echo", async () => {
        const { socket, requester } = createRequester();

        const coins = ["BTC", "ETH", "SOL", "DOGE"];
        const promises = coins.map((coin) => requester.request("subscribe", { type: "l2Book", coin }));

        // Answered out of order, as a reconnect burst would be.
        for (const coin of [...coins].reverse()) {
          socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin }));
        }

        const results = (await Promise.all(promises)) as { subscription: { coin: string } }[];
        assertEquals(
          results.map((result) => result.subscription.coin),
          coins,
        );
      });

      test("a 500-subscribe burst resolves each pending from out-of-order echoes", async () => {
        const { socket, requester } = createRequester();

        const coins = Array.from({ length: 500 }, (_, i) => `COIN${i}`);
        const promises = coins.map((coin) => requester.request("subscribe", { type: "l2Book", coin }));

        // The reconnect shape: every request in flight at once, echoes arriving out of order.
        for (const coin of [...coins].reverse()) {
          socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin }));
        }

        const results = (await Promise.all(promises)) as { subscription: { coin: string } }[];
        assertEquals(
          results.map((result) => result.subscription.coin),
          coins,
        );
      });

      test("an echo carrying server-added fields still matches via the subset fallback", async () => {
        const { socket, requester } = createRequester();

        const promise = requester.request("subscribe", { type: "l2Book", coin: "BTC" });

        // The extra fields break the exact-id match, so only the subset scan can resolve this.
        socket.mockMessage(
          RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin: "BTC", nSigFigs: null, mantissa: null }),
        );
        const result = (await promise) as Record<string, unknown>;
        assertEquals((result.subscription as Record<string, unknown>).coin, "BTC");
      });

      test("duplicate subscriptions resolve in enqueue order", async () => {
        const { socket, requester } = createRequester();
        const payload = { type: "l2Book", coin: "BTC" };

        const resolved: number[] = [];
        const p1 = requester.request("subscribe", payload).then(() => resolved.push(1));
        const p2 = requester.request("subscribe", payload).then(() => resolved.push(2));

        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await drain();
        assertEquals(resolved, [1]);

        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await drain();
        assertEquals(resolved, [1, 2]);

        await Promise.all([p1, p2]);
      });

      test("sends unsubscription and receives its echo", async () => {
        const { socket, requester } = createRequester();
        const payload = { channel: "test-sub", param: "XYZ" };

        const promise = requester.request("unsubscribe", payload);
        const sent = getLastSent(socket);
        assertEquals(sent.method, "unsubscribe");

        socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", payload));
        const result = (await promise) as Record<string, unknown>;
        assertEquals(result.method, "unsubscribe");
        assertEquals(result.subscription, payload);
      });

      test("an error echo whose body is not valid JSON rejects nothing", async () => {
        const { socket, requester } = createRequester();
        const payload = { channel: "test", param: "test" };

        const promise = requester.request("subscribe", payload);

        // The `{…}` body is not JSON; the parse failure must not escape the event listener,
        // and no pending request may be rejected by it.
        socket.mockMessage(RESPONSES.errorChannel(`Something failed: {method:subscribe,subscription}`));

        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        const result = (await promise) as Record<string, unknown>;
        assertEquals(result.method, "subscribe");
      });

      describe("an echo matches the most specific pending payload", () => {
        test("confirmation of the superset does not resolve the subset", async () => {
          const { socket, requester } = createRequester();
          const subset = { type: "l2Book", coin: "BTC" };
          const superset = { type: "l2Book", coin: "BTC", nSigFigs: 5 };

          const subsetPromise = requester.request("subscribe", subset);
          const supersetPromise = requester.request("subscribe", superset);

          socket.mockMessage(
            RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin: "BTC", nSigFigs: 5, mantissa: null }),
          );
          const supersetResult = (await supersetPromise) as Record<string, unknown>;
          assertEquals((supersetResult.subscription as Record<string, unknown>).nSigFigs, 5);

          socket.mockMessage(
            RESPONSES.subscriptionResponse("subscribe", {
              type: "l2Book",
              coin: "BTC",
              nSigFigs: null,
              mantissa: null,
            }),
          );
          const subsetResult = (await subsetPromise) as Record<string, unknown>;
          assertEquals((subsetResult.subscription as Record<string, unknown>).nSigFigs, null);
        });

        test("an error echo of the superset does not reject the subset", async () => {
          const { socket, requester } = createRequester();
          const subset = { type: "l2Book", coin: "BTC" };
          const superset = { type: "l2Book", coin: "BTC", nSigFigs: 999 };

          const subsetPromise = requester.request("subscribe", subset);
          const supersetPromise = requester.request("subscribe", superset);

          const echo = JSON.stringify({ method: "subscribe", subscription: superset });
          socket.mockMessage(RESPONSES.errorChannel(`Error parsing JSON into valid websocket request: ${echo}`));
          await assertRejects(() => supersetPromise, WebSocketRequestError);

          socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", subset));
          const result = (await subsetPromise) as Record<string, unknown>;
          assertEquals(result.method, "subscribe");
        });
      });

      describe("echo id fast path", () => {
        test("a verbatim echo in normalized key order resolves through the verbatim bucket", async () => {
          const { socket, requester } = createRequester();
          // Keys already in normalized order: the echo's verbatim serialization IS the entry id.
          const payload = { coin: "BTC", type: "l2Book" };

          const promise = requester.request("subscribe", payload);
          socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));

          const result = (await promise) as Record<string, unknown>;
          assertEquals((result.subscription as Record<string, unknown>).coin, "BTC");
        });

        test("an echo in non-normalized key order falls back to the normalized id", async () => {
          const { socket, requester } = createRequester();
          const payload = { type: "l2Book", coin: "BTC" };

          const promise = requester.request("subscribe", payload);
          // The pending id is normalized (`coin` before `type`), so this verbatim serialization
          // misses the bucket and the normalized lookup must answer instead.
          socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin: "BTC" }));

          const result = (await promise) as Record<string, unknown>;
          assertEquals((result.subscription as Record<string, unknown>).coin, "BTC");
        });

        test("an echo with different hex casing falls back to the normalized id", async () => {
          const { socket, requester } = createRequester();
          const payload = { type: "userFills", user: "0xabcdef" };

          const promise = requester.request("subscribe", payload);
          // The pending id carries the lowercased address, so the verbatim serialization of
          // this echo misses; the normalized lookup and the case-insensitive subset check match.
          socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", { type: "userFills", user: "0xAbCdEf" }));

          const result = (await promise) as Record<string, unknown>;
          assertEquals((result.subscription as Record<string, unknown>).user, "0xAbCdEf");
        });
      });

      describe("request() subscription-id hint", () => {
        test("a hinted subscribe sends the payload as-is and matches a verbatim echo", async () => {
          const { socket, requester } = createRequester();
          // Normalized form, as the subscription manager hands it over.
          const payload = { coin: "BTC", type: "l2Book" };

          const promise = requester.request("subscribe", payload, undefined, { subscriptionId: requestToId(payload) });
          const sent = getLastSent(socket);
          assertEquals(sent.method, "subscribe");
          assertEquals(sent.subscription, payload);

          socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
          const result = (await promise) as Record<string, unknown>;
          assertEquals((result.subscription as Record<string, unknown>).coin, "BTC");
        });

        test("a hinted unsubscribe matches its echo", async () => {
          const { socket, requester } = createRequester();
          const payload = { coin: "BTC", type: "l2Book" };

          const promise = requester.request("unsubscribe", payload, undefined, {
            subscriptionId: requestToId(payload),
          });
          socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", payload));

          const result = (await promise) as Record<string, unknown>;
          assertEquals(result.method, "unsubscribe");
        });

        test("a hinted pending still matches a rewritten echo via the subset fallback", async () => {
          const { socket, requester } = createRequester();
          const payload = { coin: "BTC", type: "l2Book" };

          const promise = requester.request("subscribe", payload, undefined, { subscriptionId: requestToId(payload) });

          // The server-added field breaks both id lookups; the subset scan — which consumes the
          // lazily computed specificity — must still resolve the pending request.
          socket.mockMessage(
            RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin: "BTC", nSigFigs: null }),
          );
          const result = (await promise) as Record<string, unknown>;
          assertEquals((result.subscription as Record<string, unknown>).coin, "BTC");
        });

        test("the hint is ignored for post requests", async () => {
          const { socket, requester } = createRequester();

          const promise = requester.request("post", { foo: "bar" }, undefined, { subscriptionId: "ignored" });
          const sent = getLastSent(socket);
          assertEquals(sent.method, "post");

          socket.mockMessage(RESPONSES.info(sent.id as number, "TestData"));
          assertEquals(await promise, "TestData");
        });
      });
    });

    test("connection close", async () => {
      const { socket, requester } = createRequester();

      const p1 = requester.request("post", { foo: "bar1" });
      const p2 = requester.request("subscribe", { sub: "bar2" });

      socket.disconnect();

      await assertRejects(() => p1, WebSocketRequestError, "WebSocket connection closed");
      await assertRejects(() => p2, WebSocketRequestError, "WebSocket connection closed");
    });

    test("connection error", async () => {
      const { socket, requester } = createRequester();

      const promise = requester.request("post", { foo: "bar" });

      socket.error();

      await assertRejects(() => promise, WebSocketRequestError, "WebSocket connection closed");
    });

    test("queues the request until the connection opens", async () => {
      const { socket, requester } = createRequester();
      socket.readyState = ReconnectingWebSocket.CONNECTING;

      const promise = requester.request("post", { foo: "bar" });
      assertEquals(socket.sentMessages.length, 0);

      socket.open();
      assertEquals(socket.sentMessages.length, 1);

      socket.mockMessage(RESPONSES.info(getLastSent(socket).id as number, "late-open"));
      assertEquals(await promise, "late-open");
    });

    test("a queued request cannot reach the server after a disconnect", async () => {
      const { socket, requester } = createRequester();
      socket.readyState = ReconnectingWebSocket.CONNECTING;

      const promise = requester.request("post", { foo: "bar" });
      socket.disconnect();
      await assertRejects(() => promise, WebSocketRequestError, "closed before the request was sent");

      socket.open();
      assertEquals(socket.sentMessages.length, 0);
    });

    test("rejects if permanently closed", async () => {
      const { socket, requester } = createRequester();

      socket.terminate(new Error("Permanently closed"));

      const err = await assertRejects(
        () => requester.request("post", { foo: "bar" }),
        WebSocketRequestError,
        "WebSocket connection permanently terminated",
      );
      assertEquals(err.cause, socket.terminationSignal.reason);
    });

    test("rejects an in-flight request when permanently closed", async () => {
      const { socket, requester } = createRequester();

      const promise = requester.request("post", { foo: "bar" });
      socket.terminate(new Error("Permanently closed"));

      const err = await assertRejects(
        () => promise,
        WebSocketRequestError,
        "WebSocket connection permanently terminated",
      );
      assertEquals(err.cause, socket.terminationSignal.reason);
    });

    test("rejects every in-flight request when permanently closed, not just the first", async () => {
      // The termination signal is fanned out from ONE listener to a Set of in-flight
      // controllers, rather than relayed per request. A fan-out that aborts while iterating
      // its own backing set — each abort runs a `finally` that deletes from it — drops
      // requests; this asserts all of them settle.
      const { socket, requester } = createRequester();

      const promises = Array.from({ length: 50 }, (_, i) =>
        assertRejects(
          () => requester.request("post", { seq: i }),
          WebSocketRequestError,
          "WebSocket connection permanently terminated",
        ),
      );
      socket.terminate(new Error("Permanently closed"));

      await Promise.all(promises);
    });

    test("a caller's own abort reason outranks the socket's when both are already aborted", async () => {
      // Reason precedence. `relay([signal, terminationSignal])` aborted with the first
      // already-aborted source in argument order, so the caller's reason won. Splitting the
      // relay from the termination branch must preserve that: gating the termination branch on
      // the controller still being unaborted is what keeps the caller's reason on top. Reversing
      // the two silently changes the error a caller sees — and nothing else in this suite covers it.
      const { socket, requester } = createRequester();

      socket.terminate(new Error("Permanently closed"));
      const controller = new AbortController();
      controller.abort(new Error("Caller gave up first"));

      const err = await assertRejects(
        () => requester.request("post", { foo: "bar" }, controller.signal),
        WebSocketRequestError,
        "Request aborted",
      );
      assertEquals((err.cause as Error).message, "Caller gave up first");
    });

    test("the socket's reason is used when only the socket is already aborted", async () => {
      const { socket, requester } = createRequester();

      socket.terminate(new Error("Permanently closed"));
      const controller = new AbortController(); // live, never aborted

      const err = await assertRejects(
        () => requester.request("post", { foo: "bar" }, controller.signal),
        WebSocketRequestError,
        "WebSocket connection permanently terminated",
      );
      assertEquals(err.cause, socket.terminationSignal.reason);
    });

    test("a settled request is not aborted by a later termination", async () => {
      // The `finally` must remove the controller from the fan-out set; otherwise a terminate
      // after the response would abort an already-resolved request's controller.
      const { socket, requester } = createRequester();

      const promise = requester.request("post", { foo: "bar" });
      socket.mockMessage(RESPONSES.info(1, { ok: true }));
      await promise;

      socket.terminate(new Error("Permanently closed"));
      await drain();
      // Resolving twice or rejecting after resolve would surface as an unhandled rejection.
      assertEquals(await promise, { ok: true });
    });

    describe("AbortSignal", () => {
      test("rejects if aborted before call", async () => {
        const { requester } = createRequester();

        const controller = new AbortController();
        controller.abort(new Error("Aborted pre-emptively"));

        const promise = requester.request("post", { foo: "bar" }, controller.signal);
        const err = await assertRejects(() => promise, WebSocketRequestError, "Request aborted");
        assertEquals((err.cause as Error).message, "Aborted pre-emptively");
      });

      test("rejects if aborted after sending", async () => {
        const { socket, requester } = createRequester();

        const controller = new AbortController();
        const promise = requester.request("post", { foo: "bar" }, controller.signal);
        assertEquals(socket.sentMessages.length, 1);

        controller.abort(new Error("Aborted after sending"));
        const err = await assertRejects(() => promise, WebSocketRequestError, "Request aborted");
        assertEquals((err.cause as Error).message, "Aborted after sending");
      });

      test("an aborted queued request is never flushed on open", async () => {
        const { socket, requester } = createRequester();
        socket.readyState = ReconnectingWebSocket.CONNECTING;

        const controller = new AbortController();
        const promise = requester.request("post", { foo: "bar" }, controller.signal);
        controller.abort(new Error("changed my mind"));
        socket.open();

        assertEquals(socket.sentMessages.length, 0);
        await assertRejects(() => promise, WebSocketRequestError, "Request aborted");
      });

      test("rejects after timeout expires", async () => {
        const { requester } = createRequester(30);

        const promise = requester.request("post", { foo: "bar" });

        const err = await assertRejects(() => promise, WebSocketRequestError, "Request timed out after 30 ms");
        assertEquals((err.cause as Error)?.name, "TimeoutError");
      });

      test("timeout: 0 expires immediately", async () => {
        const { requester } = createRequester(0);

        const promise = requester.request("post", { foo: "bar" });

        await assertRejects(() => promise, WebSocketRequestError, "Request timed out after 0 ms");
      });

      test("timeout: null disables timeout", async () => {
        const { socket, requester } = createRequester(null);

        const promise = requester.request("post", { foo: "bar" });
        const sent = getLastSent(socket);

        setTimeout(() => {
          socket.mockMessage(RESPONSES.info(sent.id as number, "late-success"));
        }, 50);

        assertEquals(await promise, "late-success");
      });

      test("timeout: Infinity never fires", async () => {
        const { socket, requester } = createRequester(Infinity);

        const promise = requester.request("post", { foo: "bar" });
        const sent = getLastSent(socket);

        setTimeout(() => {
          socket.mockMessage(RESPONSES.info(sent.id as number, "late-success"));
        }, 50);

        assertEquals(await promise, "late-success");
      });

      test("the timeout message reports the value the timer was armed with", async () => {
        const { requester } = createRequester(30);

        const promise = requester.request("post", { foo: "bar" });
        requester.timeout = null;

        await assertRejects(() => promise, WebSocketRequestError, "Request timed out after 30 ms");
      });
    });

    test("cleanup of a finished request keeps its duplicate pending", async () => {
      const { socket, requester } = createRequester();
      const payload = { channel: "x" };

      const p1 = requester.request("subscribe", payload);
      const controller = new AbortController();
      const p2 = requester.request("subscribe", payload, controller.signal);

      controller.abort(new Error("cancel the duplicate"));
      await assertRejects(() => p2, WebSocketRequestError, "Request aborted");

      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      const result = (await p1) as Record<string, unknown>;
      assertEquals(result.method, "subscribe");
    });
  });
});
