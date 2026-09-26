/**
 * Tests for the per-IP WebSocket budget: subscription and unique-user reservations shared
 * across connections, outbound message pacing that must never delay or reorder a `post`,
 * and the reconnect flush's exactly-once charging of held-back frames.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@jsr/std__assert";
import { TokenBucketRateLimiter } from "../../../src/transport/_rateLimiter.ts";
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
    test("direct construction is accounting-only: nothing waits", () => {
      // The pacing default belongs to `sharedWebSocketQuota` alone; a directly constructed
      // quota without `rateLimit` is the documented opt-out and must never delay a frame.
      const quota = new WebSocketQuota();
      // `undefined` rather than a resolved promise, so the caller can stay synchronous.
      assertEquals(quota.acquireSend(), undefined);
      quota.chargeSend();
    });

    test("pacing on: acquireSend stays synchronous until the bucket drains", async () => {
      // `rateLimit: {}` is exactly how the shared default enables pacing (there it means
      // capacity 2000, refilling 2000/minute); a tiny bucket with a glacial refill keeps
      // the drain cheap and the token arithmetic immune to elapsed wall time.
      const quota = new WebSocketQuota({ rateLimit: { capacity: 2, refillPerMinute: 1 } });

      // Sync fast path: the bucket covers the message, so no promise is handed back — a
      // resolved one would cost every uncontended subscribe its synchronicity, the
      // load-bearing property documented on `acquireSend`.
      assertEquals(quota.acquireSend(), undefined);

      // Drain the last token the way a post would.
      quota.chargeSend();

      // Now the wait is real: a promise comes back and the caller must await it.
      const controller = new AbortController();
      const paced = quota.acquireSend(controller.signal);
      assert(paced instanceof Promise);
      // Abandon the wait rather than letting a refill timer resolve it after the test.
      controller.abort(new Error("drained"));
      await assertRejects(() => paced, Error, "drained");
    });

    test("an already-aborted signal rejects without spending a token", async () => {
      // Capacity 1 with a glacial refill: if the aborted call below spent the only token,
      // the follow-up probe could not stay synchronous. The synchronous fast path must not
      // bypass `acquire`'s already-aborted contract — an aborted request's frame is never
      // sent, so budget spent on it would only throttle the legitimate traffic behind it.
      const quota = new WebSocketQuota({ rateLimit: { capacity: 1, refillPerMinute: 1 } });
      const aborted = AbortSignal.abort(new Error("gone before pacing"));

      const paced = quota.acquireSend(aborted);
      assert(paced instanceof Promise);
      await assertRejects(() => paced, Error, "gone before pacing");

      // The token is still there: the fast path answers synchronously.
      assertEquals(quota.acquireSend(), undefined);
    });

    test("terminating the connection abandons a paced wait and frees its queue slot", async () => {
      const quota = new WebSocketQuota({ rateLimit: { capacity: 1, refillPerMinute: 1 } });
      const { socket, manager } = createManager(quota);

      await subscribeConfirmed(socket, manager, { channel: "one" }); // spends the only token
      assertEquals(socket.sentMessages.length, 1);

      // Parked in the limiter FIFO: the bucket is empty and the refill is glacial. A closed
      // transport must not leave this waiter behind — it would eventually spend a token on a
      // frame that can never send, and hold its FIFO slot ahead of live transports sharing
      // the quota.
      const parked = manager.subscribe("test", { channel: "two" }, () => {});
      parked.catch(() => {});
      assertEquals(socket.sentMessages.length, 1); // never reached the socket

      socket.terminate();
      await assertRejects(() => parked, WebSocketRequestError, "permanently terminated");

      // The waiter left the FIFO without spending: no head remains to block other callers.
      const limiter = (quota as unknown as { _limiter: { _head?: unknown } })._limiter;
      assertEquals(limiter._head, undefined);
    });

    test("termination is observed even while a live caller signal rides the paced wait", async () => {
      // A caller-supplied signal must compose with — not replace — the termination signal:
      // were it the only abort source, a terminated transport's paced request would sit in
      // the FIFO until the caller aborted or a refill granted it a token for a dead frame.
      const quota = new WebSocketQuota({ rateLimit: { capacity: 1, refillPerMinute: 1 } });
      const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
      const hlEvents = new HyperliquidEventTarget(socket);
      const dispatcher = new WebSocketDispatcher(socket, hlEvents, 10_000, quota);

      quota.chargeSend(); // drain the only token, so the request below parks
      const caller = new AbortController(); // live for the whole test, never aborted
      const parked = dispatcher.request("subscribe", { channel: "late" }, caller.signal);
      parked.catch(() => {});

      socket.terminate();
      await assertRejects(() => parked, WebSocketRequestError, "permanently terminated");

      // The waiter left the FIFO without spending its token.
      const limiter = (quota as unknown as { _limiter: { _head?: unknown } })._limiter;
      assertEquals(limiter._head, undefined);
    });

    test("the shared default quota paces outbound messages", () => {
      const testnet = sharedWebSocketQuota(true);

      // One synchronous probe, spending a single token of 2000: the fast path holds on the
      // shared instance without disturbing the process-wide budget other tests draw on
      // (every default-quota transport in this run shares these instances).
      assertEquals(testnet.acquireSend(), undefined);

      // Proving the limiter exists *behaviourally* would mean draining 2000 tokens of
      // process-wide state and throttling every offline test still to run, so pacing is
      // asserted structurally here; the drain behaviour is covered above on isolated
      // instances built with the same `rateLimit` shape.
      const limiter = (testnet as unknown as { _limiter: TokenBucketRateLimiter | null })._limiter;
      assert(limiter instanceof TokenBucketRateLimiter);
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

  describe("reconnect flush charging", () => {
    /** A dispatcher over a mock socket that has already lost its connection. */
    function createDisconnectedDispatcher(quota: WebSocketQuota): {
      socket: MockWebSocket;
      dispatcher: WebSocketDispatcher;
    } {
      const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
      const hlEvents = new HyperliquidEventTarget(socket);
      const dispatcher = new WebSocketDispatcher(socket, hlEvents, 10_000, quota);
      socket.disconnect(); // the drop happens before any request below is made
      return { socket, dispatcher };
    }

    /**
     * Asserts the bucket holds exactly `tokens` more whole tokens, by probing: that many
     * synchronous acquires must succeed and the next must park. The glacial refills the
     * tests below configure keep the count a step function of the charges made.
     */
    async function assertRemainingTokens(quota: WebSocketQuota, tokens: number): Promise<void> {
      for (let i = 0; i < tokens; i++) assertEquals(quota.acquireSend(), undefined);
      const controller = new AbortController();
      const parked = quota.acquireSend(controller.signal);
      assert(parked instanceof Promise);
      // Abandon the wait rather than letting a refill timer resolve it after the test.
      controller.abort(new Error("probe done"));
      await assertRejects(() => parked, Error, "probe done");
    }

    test("a post queued while disconnected debits the budget exactly once when flushed", async () => {
      const quota = new WebSocketQuota({ rateLimit: { capacity: 3, refillPerMinute: 1 } });
      const { socket, dispatcher } = createDisconnectedDispatcher(quota);

      const post = dispatcher.request("post", { type: "test" });
      post.catch(() => {});
      // Held back while disconnected: nothing on the wire, and — posts pay only when their
      // frame reaches the socket — nothing charged yet.
      assertEquals(socket.sentMessages.length, 0);

      socket.open(); // reconnect: the `open` flush sends the held-back frame
      assertEquals(socket.sentMessages.length, 1);

      // Exactly one token of three is spent. A double charge would leave one; a missed
      // charge (the original bug: the flush skipped the debit entirely) would leave three.
      await assertRemainingTokens(quota, 2);

      // Settle the flushed post so its request timeout does not outlive the test.
      socket.mockMessage(RESPONSES.info(1, "ok"));
      assertEquals(await post, "ok");
    });

    test("a subscribe flushed on open is not charged again — it paid at request() time", async () => {
      const quota = new WebSocketQuota({ rateLimit: { capacity: 2, refillPerMinute: 1 } });
      const { socket, dispatcher } = createDisconnectedDispatcher(quota);

      // The token is acquired synchronously in `acquireSend` at request() time, even
      // though the frame itself is held back until the connection returns.
      const pending = dispatcher.request("subscribe", { channel: "one" });
      pending.catch(() => {});
      assertEquals(socket.sentMessages.length, 0);

      socket.open(); // reconnect: the `open` flush sends the held-back frame
      assertEquals(socket.sentMessages.length, 1);

      // Still exactly one token of two spent: the flush charges only posts, so the
      // subscribe was not double-charged for reaching the socket late.
      await assertRemainingTokens(quota, 1);

      // Settle the flushed subscribe.
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", { channel: "one" }));
      await pending;
    });
  });
});
