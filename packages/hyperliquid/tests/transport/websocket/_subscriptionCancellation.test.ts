/** Regression coverage for retiring subscription attempts before their frames reach the socket. */
import { describe, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import type { ReconnectingWebSocket } from "../../../src/transport/websocket/_reconnectingSocket.ts";
import { WebSocketDispatcher, WebSocketRequestError } from "../../../src/transport/websocket/_dispatcher.ts";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";
import { WebSocketQuota } from "../../../src/transport/websocket/_quota.ts";
import { WebSocketSubscriptionManager } from "../../../src/transport/websocket/_subscriptionManager.ts";
import { drain, FakeRuntime } from "../../_fakeRuntime.ts";
import { MockWebSocket, RESPONSES } from "./_mock.ts";

function createManager(paced = true, resubscribe = true) {
  const runtime = new FakeRuntime();
  const quota = new WebSocketQuota({
    runtime,
    rateLimit: paced ? { capacity: 1, refillPerMinute: 60 } : undefined,
  });
  const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
  const events = new HyperliquidEventTarget(socket);
  const dispatcher = new WebSocketDispatcher(socket, events, null, quota, runtime);
  const manager = new WebSocketSubscriptionManager(socket, dispatcher, events, resubscribe, quota);
  return { socket, manager, quota, runtime };
}

function frames(socket: MockWebSocket) {
  return socket.sentMessages.map((frame) => JSON.parse(frame));
}

const oldPayload = { type: "l2Book", coin: "OLD" };
const livePayload = { type: "l2Book", coin: "LIVE" };

describe("subscription cancellation before send", () => {
  test("a retired paced attempt spends no tokens or frames ahead of a live subscription", async () => {
    const { manager, socket, quota, runtime } = createManager();
    assertEquals(quota.acquireSend(), undefined); // exhaust the initial token
    const controller = new AbortController();
    const old = manager.subscribe("l2Book", oldPayload, () => {}, { signal: controller.signal });
    controller.abort(new Error("no longer needed"));
    await assertRejects(() => old, WebSocketRequestError, "Subscription was aborted");
    assertEquals(quota.subscriptions, 0);
    assertEquals(frames(socket), []);
    assertEquals(runtime.pendingTimers, 0);

    const live = manager.subscribe("l2Book", livePayload, () => {});
    runtime.advance(1_000);
    await drain();
    assertEquals(frames(socket), [{ method: "subscribe", subscription: livePayload }]);
    socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", livePayload));
    await live;
    runtime.advance(10_000);
    await drain();
    assertEquals(socket.sentMessages.length, 1); // no obsolete unsubscribe follows
    socket.terminate();
  });

  test("caller abort beats a quota refill in the same turn", async () => {
    const { manager, socket, quota, runtime } = createManager();
    quota.acquireSend();
    const controller = new AbortController();
    const old = manager.subscribe("l2Book", oldPayload, () => {}, { signal: controller.signal });
    controller.abort();
    runtime.advance(1_000); // do not wait for manager.subscribe's catch before refilling
    await assertRejects(() => old, WebSocketRequestError, "Subscription was aborted");
    const live = manager.subscribe("l2Book", livePayload, () => {});
    assertEquals(frames(socket), [{ method: "subscribe", subscription: livePayload }]);
    socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", livePayload));
    await live;
    socket.terminate();
  });

  test("one cancelled lease cannot cancel a shared paced attempt", async () => {
    const { manager, socket, quota, runtime } = createManager();
    quota.acquireSend();
    const controller = new AbortController();
    let updates = 0;
    const listener = () => updates++;
    const creator = manager.subscribe("l2Book", oldPayload, listener, { signal: controller.signal });
    const joiner = manager.subscribe("l2Book", oldPayload, listener);
    controller.abort();
    await assertRejects(() => creator, WebSocketRequestError, "Subscription was aborted");
    assertEquals(quota.subscriptions, 1);

    runtime.advance(1_000);
    await drain();
    assertEquals(frames(socket), [{ method: "subscribe", subscription: oldPayload }]);
    socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", oldPayload));
    const handle = await joiner;
    socket.mockMessage(RESPONSES.channelEvent("l2Book", { coin: "OLD", levels: [] }));
    assertEquals(updates, 1);

    const unsubscribe = handle.unsubscribe();
    runtime.advance(1_000);
    await drain();
    assertEquals(frames(socket)[1], { method: "unsubscribe", subscription: oldPayload });
    socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", oldPayload));
    await unsubscribe;
    assertEquals(quota.subscriptions, 0);
    socket.terminate();
  });

  test("an aborted disconnected attempt cannot flush on the next open", async () => {
    const { manager, socket, quota } = createManager(false);
    socket.disconnect();
    const controller = new AbortController();
    const old = manager.subscribe("l2Book", oldPayload, () => {}, { signal: controller.signal });
    controller.abort();
    socket.open(); // synchronous open must not outrun the caller's rejection continuation
    await assertRejects(() => old, WebSocketRequestError, "Subscription was aborted");
    await drain();
    assertEquals(frames(socket), []);
    assertEquals(quota.subscriptions, 0);
    socket.terminate();
  });

  test("a frame flushed on open still needs unsubscribe if its final waiter aborts", async () => {
    const { manager, socket } = createManager(false);
    socket.disconnect();
    const controller = new AbortController();
    const old = manager.subscribe("l2Book", oldPayload, () => {}, { signal: controller.signal });
    socket.open();
    assertEquals(frames(socket), [{ method: "subscribe", subscription: oldPayload }]);
    controller.abort();
    await assertRejects(() => old, WebSocketRequestError, "Subscription was aborted");
    assertEquals(frames(socket), [
      { method: "subscribe", subscription: oldPayload },
      { method: "unsubscribe", subscription: oldPayload },
    ]);
    socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", oldPayload));
    socket.terminate();
  });

  test("a subscription failed by a non-resubscribing disconnect leaves the paced queue", async () => {
    const { manager, socket, quota, runtime } = createManager(true, false);
    quota.acquireSend();
    const old = manager.subscribe("l2Book", oldPayload, () => {});
    socket.disconnect();
    await assertRejects(() => old, WebSocketRequestError, "WebSocket connection closed");
    assertEquals(quota.subscriptions, 0);
    socket.open();
    runtime.advance(1_000);
    await drain();
    assertEquals(frames(socket), []);

    const live = manager.subscribe("l2Book", livePayload, () => {});
    assertEquals(frames(socket), [{ method: "subscribe", subscription: livePayload }]);
    socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", livePayload));
    await live;
    socket.terminate();
  });

  test("unsubscribing a confirmed lease cancels its unsent reconnect attempt", async () => {
    const { manager, socket, quota, runtime } = createManager();
    let failures = 0;
    const initial = manager.subscribe("l2Book", oldPayload, () => {}, { onError: () => failures++ });
    socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", oldPayload));
    const handle = await initial;
    socket.disconnect();
    await drain();
    socket.open(); // its re-subscribe must wait for replenished quota
    await handle.unsubscribe();
    assertEquals(quota.subscriptions, 0);

    const live = manager.subscribe("l2Book", livePayload, () => {});
    runtime.advance(1_000);
    await drain();
    assertEquals(frames(socket), [
      { method: "subscribe", subscription: oldPayload },
      { method: "subscribe", subscription: livePayload },
    ]);
    socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", livePayload));
    await live;
    assertEquals(failures, 0);
    socket.terminate();
  });
});
