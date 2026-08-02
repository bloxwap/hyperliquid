/**
 * Tests for the per-IP WebSocket budget: subscription and unique-user reservations shared
 * across connections, and outbound message pacing that must never delay or reorder a `post`.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@jsr/std__assert";
import type { ReconnectingWebSocket } from "../../../src/transport/websocket/_reconnectingSocket.ts";
import { WebSocketDispatcher, WebSocketRequestError } from "../../../src/transport/websocket/_dispatcher.ts";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";
import { sharedWebSocketQuota, WebSocketQuota } from "../../../src/transport/websocket/_quota.ts";
import { WebSocketSubscriptionManager } from "../../../src/transport/websocket/_subscriptionManager.ts";
import { drain, MockWebSocket, RESPONSES } from "./_mock.ts";

// =============================================================================
// Helpers
// =============================================================================

/** A manager over a mock socket, optionally sharing an explicit quota. */
function createManager(quota?: WebSocketQuota): { socket: MockWebSocket; manager: WebSocketSubscriptionManager } {
  const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
  const hlEvents = new HyperliquidEventTarget(socket);
  const dispatcher = new WebSocketDispatcher(socket, hlEvents, 10_000, quota);
  const manager = new WebSocketSubscriptionManager(socket, dispatcher, hlEvents, true, quota);
  return { socket, manager };
}

/**
 * Subscribes and confirms it against the mock server, so the reservation settles.
 *
 * The `drain()` before the response is required once pacing is on: `subscribe` awaits its
 * token before the frame reaches the socket, so a confirmation sent in the same tick would
 * arrive before the request it confirms and never match.
 */
async function subscribeConfirmed(
  socket: MockWebSocket,
  manager: WebSocketSubscriptionManager,
  payload: Record<string, unknown>,
): Promise<{ unsubscribe: () => Promise<void> }> {
  const pending = manager.subscribe("test", payload, () => {});
  await drain();
  socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
  return await pending;
}

/** Unsubscribes and answers the wire `unsubscribe` request the manager sends. */
async function unsubscribeConfirmed(
  socket: MockWebSocket,
  sub: { unsubscribe: () => Promise<void> },
  payload: Record<string, unknown>,
): Promise<void> {
  const pending = sub.unsubscribe();
  await drain();
  socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", payload));
  await pending;
}

// =============================================================================
// Tests
// =============================================================================

describe("WebSocketQuota", () => {
  describe("subscription budget", () => {
    test("counts reservations and releases them", () => {
      const quota = new WebSocketQuota();

      assertEquals(quota.reserveSubscription(undefined), undefined);
      assertEquals(quota.subscriptions, 1);
      quota.releaseSubscription(undefined);
      assertEquals(quota.subscriptions, 0);
    });

    test("refuses past maxSubscriptions, naming the limit that refused", () => {
      const quota = new WebSocketQuota({ maxSubscriptions: 2 });

      assertEquals(quota.reserveSubscription(undefined), undefined);
      assertEquals(quota.reserveSubscription(undefined), undefined);
      assertEquals(quota.reserveSubscription(undefined), "subscriptions");
      // A refused reservation must not consume a slot.
      assertEquals(quota.subscriptions, 2);
    });

    test("several subscriptions for one user cost one user slot", () => {
      const quota = new WebSocketQuota({ maxUniqueUsers: 1 });

      assertEquals(quota.reserveSubscription("0xaaa"), undefined);
      assertEquals(quota.reserveSubscription("0xaaa"), undefined);
      assertEquals(quota.uniqueUsers, 1);
      // A second distinct user is one too many.
      assertEquals(quota.reserveSubscription("0xbbb"), "users");
      // The slot is freed only once the last subscription for that user goes.
      quota.releaseSubscription("0xaaa");
      assertEquals(quota.uniqueUsers, 1);
      quota.releaseSubscription("0xaaa");
      assertEquals(quota.uniqueUsers, 0);
      assertEquals(quota.reserveSubscription("0xbbb"), undefined);
    });

    test("null disables a guard", () => {
      const quota = new WebSocketQuota({ maxSubscriptions: null, maxUniqueUsers: null });
      for (let i = 0; i < 2_000; i++) assertEquals(quota.reserveSubscription(`0x${i}`), undefined);
      assertEquals(quota.subscriptions, 2_000);
    });
  });

  describe("sharing across connections", () => {
    test("two managers on one quota share the subscription budget", async () => {
      // The regression this whole module exists for: before the quota, each manager kept its
      // own count and two transports admitted 2x the limit against a budget the server
      // scopes per IP.
      const quota = new WebSocketQuota({ maxSubscriptions: 2 });
      const a = createManager(quota);
      const b = createManager(quota);

      await subscribeConfirmed(a.socket, a.manager, { channel: "one" });
      await subscribeConfirmed(b.socket, b.manager, { channel: "two" });
      assertEquals(quota.subscriptions, 2);

      // The third subscription is refused client-side even though it is the first on a
      // third connection — the server would have refused it without echoing the request.
      await assertRejects(
        () => b.manager.subscribe("test", { channel: "three" }, () => {}),
        WebSocketRequestError,
        "Cannot subscribe to more than 2 channels.",
      );
    });

    test("two managers on one quota share the unique-user budget", async () => {
      const quota = new WebSocketQuota({ maxUniqueUsers: 1 });
      const a = createManager(quota);
      const b = createManager(quota);

      await subscribeConfirmed(a.socket, a.manager, { channel: "c", user: "0xAAA" });
      await assertRejects(
        () => b.manager.subscribe("test", { channel: "c", user: "0xBBB" }, () => {}),
        WebSocketRequestError,
        "Cannot track more than 1 total users.",
      );
    });

    test("unsubscribing on one connection frees the slot for another", async () => {
      const quota = new WebSocketQuota({ maxSubscriptions: 1 });
      const a = createManager(quota);
      const b = createManager(quota);

      const sub = await subscribeConfirmed(a.socket, a.manager, { channel: "one" });
      await assertRejects(() => b.manager.subscribe("test", { channel: "two" }, () => {}), WebSocketRequestError);

      await unsubscribeConfirmed(a.socket, sub, { channel: "one" });
      assertEquals(quota.subscriptions, 0);
      await subscribeConfirmed(b.socket, b.manager, { channel: "two" });
      assertEquals(quota.subscriptions, 1);
    });

    test("a permanently terminated connection returns its slots", async () => {
      const quota = new WebSocketQuota({ maxSubscriptions: 1 });
      const a = createManager(quota);
      const b = createManager(quota);

      await subscribeConfirmed(a.socket, a.manager, { channel: "one" });
      assertEquals(quota.subscriptions, 1);

      // Terminal close fails every subscription, which is exactly when the server frees them.
      a.socket.terminate();
      assertEquals(quota.subscriptions, 0);
      await subscribeConfirmed(b.socket, b.manager, { channel: "two" });
      assertEquals(quota.subscriptions, 1);
    });

    test("a refused subscription leaves the budget untouched", async () => {
      const quota = new WebSocketQuota({ maxSubscriptions: 1 });
      const { socket, manager } = createManager(quota);

      await subscribeConfirmed(socket, manager, { channel: "one" });
      await assertRejects(() => manager.subscribe("test", { channel: "two" }, () => {}), WebSocketRequestError);
      assertEquals(quota.subscriptions, 1);
    });

    test("sharedWebSocketQuota keys by network", () => {
      const mainnet = sharedWebSocketQuota(false);
      const testnet = sharedWebSocketQuota(true);

      // Every transport on one network draws from one budget, which is the whole point.
      assert(sharedWebSocketQuota(false) === mainnet);
      assert(sharedWebSocketQuota(true) === testnet);
      // Mainnet and testnet are different servers keeping different per-IP counters.
      assert(mainnet !== testnet);
    });
  });

  describe("outbound message budget", () => {
    test("accounting-only by default: nothing waits", () => {
      const quota = new WebSocketQuota();
      // `undefined` rather than a resolved promise, so the caller can stay synchronous.
      assertEquals(quota.acquireSend(), undefined);
      quota.chargeSend();
    });

    test("subscribe waits once the bucket is empty", async () => {
      // Capacity 1 refilling at 60/minute: the second subscribe cannot go out for ~1 s.
      const quota = new WebSocketQuota({ rateLimit: { capacity: 1, refillPerMinute: 60 } });
      const { socket, manager } = createManager(quota);

      await subscribeConfirmed(socket, manager, { channel: "one" });
      assertEquals(socket.sentMessages.length, 1);

      // Deliberately left parked: this call is never confirmed, so it must be caught here.
      // A floating rejection outlives this file — the parked subscribe eventually sends, waits
      // out its 10 s request timeout, and rejects long after the test that created it has
      // passed, surfacing as an "Unhandled error between tests" against whichever file is
      // running by then and failing the whole suite with 0 reported failures.
      const parked = manager.subscribe("test", { channel: "two" }, () => {});
      parked.catch(() => {});

      await drain();
      // Still parked in the bucket: the frame has not reached the socket.
      assertEquals(socket.sentMessages.length, 1);

      // Terminate rather than leaving the request pending: the rejection lands now, on the
      // handler above, instead of on a timer after this test returns.
      socket.terminate();
      await parked.catch(() => {});
    });

    test("post never waits, even with an empty bucket", async () => {
      // The load-bearing guarantee: `_shell.ts` fixes the wire order of an exchange action on
      // `transport.request` reaching `send` synchronously. If pacing ever awaited on the post
      // path, a later nonce could overtake an earlier one.
      const quota = new WebSocketQuota({ rateLimit: { capacity: 0.5, refillPerMinute: 1 } });
      const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
      const hlEvents = new HyperliquidEventTarget(socket);
      const dispatcher = new WebSocketDispatcher(socket, hlEvents, 10_000, quota);

      // Not awaited and no microtask drained: the frame must already be on the socket.
      dispatcher.request("post", { type: "action" }).catch(() => {});
      assertEquals(socket.sentMessages.length, 1);

      // And a burst stays in issue order, which is what nonce ordering depends on.
      for (let i = 0; i < 20; i++) dispatcher.request("post", { seq: i }).catch(() => {});
      const seqs = socket.sentMessages
        .slice(1)
        .map((frame) => (JSON.parse(frame) as { request: { seq: number } }).request.seq);
      assertEquals(
        seqs,
        Array.from({ length: 20 }, (_, i) => i),
      );

      // Settle the 21 pending posts now; otherwise each carries a live 10 s request timeout
      // into the rest of the run.
      socket.terminate();
    });

    test("posts spend the budget subscribes then wait off", async () => {
      // One socket, one quota, both a dispatcher and a manager on it — the production shape.
      const quota = new WebSocketQuota({ rateLimit: { capacity: 2, refillPerMinute: 60 } });
      const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
      const hlEvents = new HyperliquidEventTarget(socket);
      const dispatcher = new WebSocketDispatcher(socket, hlEvents, 10_000, quota);
      const manager = new WebSocketSubscriptionManager(socket, dispatcher, hlEvents, true, quota);

      // Two posts drain the bucket without waiting...
      dispatcher.request("post", { a: 1 }).catch(() => {});
      dispatcher.request("post", { a: 2 }).catch(() => {});
      const afterPosts = socket.sentMessages.length;
      assertEquals(afterPosts, 2);

      // ...so the next subscribe has to wait for a refill.
      manager.subscribe("test", { channel: "one" }, () => {}).catch(() => {});
      await drain();
      assertEquals(socket.sentMessages.length, afterPosts);

      socket.terminate(); // settle the parked subscribe and the two posts before returning
    });

    test("an aborted wait never sends and never spends a token", async () => {
      const quota = new WebSocketQuota({ rateLimit: { capacity: 1, refillPerMinute: 60 } });
      const { socket, manager } = createManager(quota);

      await subscribeConfirmed(socket, manager, { channel: "one" });
      const sent = socket.sentMessages.length;

      const controller = new AbortController();
      const pending = manager.subscribe("test", { channel: "two" }, () => {}, { signal: controller.signal });
      await drain();
      controller.abort();

      await assertRejects(() => pending, WebSocketRequestError);
      assertEquals(socket.sentMessages.length, sent);
      // The abandoned reservation is returned rather than stranded.
      assertEquals(quota.subscriptions, 1);
    });
  });
});
