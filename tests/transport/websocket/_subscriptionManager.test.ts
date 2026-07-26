/**
 * Tests for the subscription lifecycle manager: listener registration,
 * resubscription across reconnects, failure reporting, and server-side limits.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertFalse, assertRejects } from "@jsr/std__assert";
import { ReconnectingWebSocket } from "../../../src/transport/websocket/_reconnectingSocket.ts";
import type { ISubscription } from "../../../src/transport/_base.ts";
import { WebSocketDispatcher, WebSocketRequestError } from "../../../src/transport/websocket/_dispatcher.ts";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";
import { WebSocketSubscriptionManager } from "../../../src/transport/websocket/_subscriptionManager.ts";
import { drain, MockWebSocket, RESPONSES } from "./_mock.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Strips private/protected modifiers so intersections with internal-state types don't collapse to `never`. */
type Public<T> = { [K in keyof T]: T[K] };
type ManagerWithInternals = Public<WebSocketSubscriptionManager> & {
  _subscriptions: Map<string, { listeners: Map<unknown, unknown> }>;
};

/** Creates a new WebSocketSubscriptionManager with mock socket. */
function createManager(resubscribe = true): { socket: MockWebSocket; manager: ManagerWithInternals } {
  const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
  const hlEvents = new HyperliquidEventTarget(socket);
  const dispatcher = new WebSocketDispatcher(socket, hlEvents, 10_000);
  const manager = new WebSocketSubscriptionManager(socket, dispatcher, hlEvents, resubscribe);
  return {
    socket,
    manager: manager as unknown as ManagerWithInternals,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("WebSocketSubscriptionManager", () => {
  describe("subscribe()", () => {
    test("standard flow: subscribe, receive event, unsubscribe", async () => {
      const { socket, manager } = createManager();

      let eventReceived = false;
      const listener = (e: CustomEvent) => {
        if (e.detail?.update === "subscription update") eventReceived = true;
      };

      const payload = { channel: "test", extra: "data" };
      const subPromise = manager.subscribe("test", payload, listener);

      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      const sub = await subPromise;

      socket.mockMessage(RESPONSES.channelEvent("test", { update: "subscription update" }));
      assertEquals(eventReceived, true);

      const unsubPromise = sub.unsubscribe();
      socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", payload));
      await unsubPromise;

      assert(manager._subscriptions.size === 0);
    });

    test("duplicate listener is not added twice", async () => {
      const { socket, manager } = createManager();

      const payload = { channel: "test", extra: "data" };
      const listener = () => {};

      const sub1Promise = manager.subscribe("test", payload, listener);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await sub1Promise;

      await manager.subscribe("test", payload, listener);

      assertEquals(manager._subscriptions.size, 1);
      assertEquals(manager._subscriptions.get(JSON.stringify(payload))?.listeners.size, 1);
    });

    test("different listeners share same subscription", async () => {
      const { socket, manager } = createManager();

      const payload = { channel: "test", extra: "data" };

      const sub1Promise = manager.subscribe("test", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await sub1Promise;

      await manager.subscribe("test", payload, () => {});

      assertEquals(manager._subscriptions.size, 1);
      assertEquals(manager._subscriptions.get(JSON.stringify(payload))?.listeners.size, 2);
    });

    test("second listener does not send subscription request", () => {
      const { socket, manager } = createManager();

      const payload = { channel: "test", extra: "data" };

      manager.subscribe("test", payload, () => {}).catch(() => {});
      manager.subscribe("test", payload, () => {}).catch(() => {});

      assertEquals(socket.sentMessages.length, 1);
    });

    test("new listeners wait for pending subscription", async () => {
      const { socket, manager } = createManager();

      const payload = { channel: "test", extra: "data" };
      const subPromise1 = manager.subscribe("test", payload, () => {});

      let secondCompleted = false;
      manager.subscribe("test", payload, () => {}).then(() => (secondCompleted = true));

      await drain();
      assertFalse(secondCompleted);

      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise1;

      await drain();
      assert(secondCompleted);
    });

    test("rejected confirmation removes the subscription", async () => {
      const { socket, manager } = createManager();
      const payload = { channel: "test", extra: "data" };

      let events = 0;
      const promise = manager.subscribe("test", payload, () => events++);
      socket.mockMessage(RESPONSES.errorChannel(`Already subscribed: ${JSON.stringify(payload)}`));
      await assertRejects(() => promise, WebSocketRequestError, "Already subscribed");

      // The listener is detached and the entry is gone.
      socket.mockMessage(RESPONSES.channelEvent("test", { update: "x" }));
      assertEquals(events, 0);
      assertEquals(manager._subscriptions.size, 0);

      // A retry is no longer poisoned by the cached rejection.
      const retry = manager.subscribe("test", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await retry;
    });

    test("limit errors carry the request payload", async () => {
      const { socket, manager } = createManager();

      for (let i = 0; i < 15; i++) {
        const payload = { type: "userEvents", user: `0x${i.toString().padStart(40, "0")}` };
        const promise = manager.subscribe("userEvents", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      const payload16 = { type: "userEvents", user: "0x000000000000000000000000000000000000000f" };
      const err = await assertRejects(
        () => manager.subscribe("userEvents", payload16, () => {}),
        WebSocketRequestError,
      );
      assertEquals(err.request, payload16);
    });
  });

  describe("AbortSignal", () => {
    test("rejects without sending when already aborted", async () => {
      const { socket, manager } = createManager();
      const payload = { channel: "test", extra: "data" };

      const signal = AbortSignal.abort(new Error("pre-aborted"));
      const err = await assertRejects(
        () => manager.subscribe("test", payload, () => {}, { signal }),
        WebSocketRequestError,
        "Subscription was aborted",
      );
      assertEquals(err.cause, signal.reason);
      assertEquals(socket.sentMessages.length, 0);
    });

    test("abort while the confirmation is pending detaches the listener", async () => {
      const { socket, manager } = createManager();
      const payload = { channel: "test", extra: "data" };

      let events = 0;
      const controller = new AbortController();
      const promise = manager.subscribe("test", payload, () => events++, { signal: controller.signal });

      controller.abort(new Error("stop waiting"));
      const err = await assertRejects(() => promise, WebSocketRequestError, "Subscription was aborted");
      assertEquals(err.cause, controller.signal.reason);
      assertEquals(manager._subscriptions.size, 0);

      // The in-flight request may still confirm: the slot is freed server-side.
      assertEquals(JSON.parse(socket.sentMessages[1]).method, "unsubscribe");

      // A late confirmation does not resurrect the subscription.
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      socket.mockMessage(RESPONSES.channelEvent("test", { update: "x" }));
      assertEquals(events, 0);
    });

    test("abort of one waiter does not affect the others", async () => {
      const { socket, manager } = createManager();
      const payload = { channel: "test", extra: "data" };

      let events = 0;
      const promise = manager.subscribe("test", payload, () => events++);

      const controller = new AbortController();
      const joiner = manager.subscribe("test", payload, () => {}, { signal: controller.signal });
      controller.abort(new Error("changed my mind"));
      await assertRejects(() => joiner, WebSocketRequestError, "Subscription was aborted");

      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await promise;

      socket.mockMessage(RESPONSES.channelEvent("test", { update: "x" }));
      assertEquals(events, 1);
      assertEquals(manager._subscriptions.get(JSON.stringify(payload))?.listeners.size, 1);
    });
  });

  describe("unsubscribe()", () => {
    test("removes listener and clears resources", async () => {
      const { socket, manager } = createManager();

      const payload = { channel: "test" };
      const subPromise = manager.subscribe("test", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      const sub = await subPromise;

      const unsubPromise = sub.unsubscribe();
      socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", payload));
      await unsubPromise;

      assert(manager._subscriptions.size === 0);
    });

    test("does not send request if other listeners exist", async () => {
      const { socket, manager } = createManager();

      const payload = { channel: "test" };

      const sub1Promise = manager.subscribe("test", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      const sub1 = await sub1Promise;

      await manager.subscribe("test", payload, () => {});

      await sub1.unsubscribe();

      assertEquals(manager._subscriptions.get(JSON.stringify(payload))?.listeners.size, 1);
    });
  });

  describe("routing", () => {
    /** Subscribes to `coin` on the `l2Book` channel and counts the frames its listener receives. */
    async function subscribeCoin(
      socket: MockWebSocket,
      manager: ManagerWithInternals,
      coin: string,
      counter: { calls: number },
    ): Promise<void> {
      const payload = { type: "l2Book", coin };
      const promise = manager.subscribe("l2Book", payload, () => counter.calls++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await promise;
    }

    test("a frame runs only the subscription that asked for it", async () => {
      const { socket, manager } = createManager();

      const btc = { calls: 0 };
      const eth = { calls: 0 };
      await subscribeCoin(socket, manager, "BTC", btc);
      await subscribeCoin(socket, manager, "ETH", eth);

      socket.mockMessage(RESPONSES.channelEvent("l2Book", { coin: "BTC", levels: [] }));

      assertEquals(btc.calls, 1);
      assertEquals(eth.calls, 0);
    });

    test("routing survives a reconnect", async () => {
      const { socket, manager } = createManager(true);

      const btc = { calls: 0 };
      const eth = { calls: 0 };
      await subscribeCoin(socket, manager, "BTC", btc);
      await subscribeCoin(socket, manager, "ETH", eth);

      socket.disconnect();
      socket.open();
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin: "BTC" }));
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", { type: "l2Book", coin: "ETH" }));
      await drain();

      socket.mockMessage(RESPONSES.channelEvent("l2Book", { coin: "ETH", levels: [] }));
      assertEquals(btc.calls, 0);
      assertEquals(eth.calls, 1);

      socket.terminate();
    });

    test("unsubscribing one coin leaves the others routed", async () => {
      const { socket, manager } = createManager();

      const btc = { calls: 0 };
      const eth = { calls: 0 };
      const payload = { type: "l2Book", coin: "BTC" };
      const subPromise = manager.subscribe("l2Book", payload, () => btc.calls++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      const sub = await subPromise;
      await subscribeCoin(socket, manager, "ETH", eth);

      const unsubPromise = sub.unsubscribe();
      socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", payload));
      await unsubPromise;

      socket.mockMessage(RESPONSES.channelEvent("l2Book", { coin: "BTC", levels: [] }));
      socket.mockMessage(RESPONSES.channelEvent("l2Book", { coin: "ETH", levels: [] }));
      assertEquals(btc.calls, 0);
      assertEquals(eth.calls, 1);
    });

    test("a frame that cannot be keyed reaches the channel's unkeyed subscriptions", async () => {
      const { socket, manager } = createManager();

      const btc = { calls: 0 };
      let unkeyed = 0;
      await subscribeCoin(socket, manager, "BTC", btc);

      // A payload without a coin cannot be keyed, so it listens on the bare channel.
      const anyCoin = { type: "l2Book" };
      const promise = manager.subscribe("l2Book", anyCoin, () => unkeyed++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", anyCoin));
      await promise;

      // A coinless frame carries no route key. It reaches the unkeyed subscription; the keyed one
      // does not see it, exactly as its `e.detail.coin === payload.coin` filter would have decided.
      socket.mockMessage(RESPONSES.channelEvent("l2Book", { levels: [] }));
      assertEquals(unkeyed, 1);
      assertEquals(btc.calls, 0);

      // A keyed frame reaches both.
      socket.mockMessage(RESPONSES.channelEvent("l2Book", { coin: "BTC", levels: [] }));
      assertEquals(unkeyed, 2);
      assertEquals(btc.calls, 1);
    });

    test("an unrouted channel still fans out", async () => {
      const { socket, manager } = createManager();

      let first = 0;
      let second = 0;
      const payload = { type: "allMids" };
      const promise = manager.subscribe("allMids", payload, () => first++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await promise;
      await manager.subscribe("allMids", payload, () => second++);

      socket.mockMessage(RESPONSES.channelEvent("allMids", { mids: {} }));
      assertEquals(first, 1);
      assertEquals(second, 1);
    });

    /**
     * Subscribes to both asset-ctx variants of `coin`. Both API methods declare the identical
     * payload type, so the server serves the perp and the spot channel from one subscription.
     */
    async function subscribeAssetCtxs(
      socket: MockWebSocket,
      manager: ManagerWithInternals,
      coin: string,
      counter: { perp: number; spot: number },
      first: "activeAssetCtx" | "activeSpotAssetCtx",
    ): Promise<{ perp: ISubscription; spot: ISubscription }> {
      const payload = { type: "activeAssetCtx", coin };
      const subs: { perp?: ISubscription; spot?: ISubscription } = {};
      const subscribe = async (channel: "activeAssetCtx" | "activeSpotAssetCtx"): Promise<void> => {
        const promise = manager.subscribe(channel, payload, () =>
          channel === "activeAssetCtx" ? counter.perp++ : counter.spot++,
        );
        // Only the first call sends a subscribe frame; the second joins the same entry.
        if (channel === first) socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        subs[channel === "activeAssetCtx" ? "perp" : "spot"] = await promise;
      };
      await subscribe(first);
      await subscribe(first === "activeAssetCtx" ? "activeSpotAssetCtx" : "activeAssetCtx");
      return subs as { perp: ISubscription; spot: ISubscription };
    }

    for (const order of ["activeAssetCtx first", "activeSpotAssetCtx first"] as const) {
      test(`perp and spot asset ctx share the wire subscription but not the frames (${order})`, async () => {
        const { socket, manager } = createManager();
        const counter = { perp: 0, spot: 0 };
        const payload = { type: "activeAssetCtx", coin: "@1" };

        const sentBefore = socket.sentMessages.length;
        const subs = await subscribeAssetCtxs(
          socket,
          manager,
          "@1",
          counter,
          order === "activeAssetCtx first" ? "activeAssetCtx" : "activeSpotAssetCtx",
        );
        // One entry, one wire subscription: the joiner sent no second subscribe frame.
        assertEquals(manager._subscriptions.size, 1);
        assertEquals(socket.sentMessages.length, sentBefore + 1);

        // Each listener receives only its own channel's frames, whichever came first.
        socket.mockMessage(RESPONSES.channelEvent("activeAssetCtx", { coin: "@1", ctx: {} }));
        assertEquals(counter, { perp: 1, spot: 0 });
        socket.mockMessage(RESPONSES.channelEvent("activeSpotAssetCtx", { coin: "@1", ctx: {} }));
        assertEquals(counter, { perp: 1, spot: 1 });

        // Unsubscribing one leaves the other's routing — and the wire subscription — intact.
        await subs.perp.unsubscribe();
        socket.mockMessage(RESPONSES.channelEvent("activeAssetCtx", { coin: "@1", ctx: {} }));
        socket.mockMessage(RESPONSES.channelEvent("activeSpotAssetCtx", { coin: "@1", ctx: {} }));
        assertEquals(counter, { perp: 1, spot: 2 });
        assertEquals(manager._subscriptions.size, 1);

        // The last listener leaving retires the shared wire subscription.
        const unsubPromise = subs.spot.unsubscribe();
        socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", payload));
        await unsubPromise;
        assertEquals(manager._subscriptions.size, 0);
      });
    }
  });

  describe("autoResubscribe", () => {
    test("resubscribes after reconnection", async () => {
      const { socket, manager } = createManager(true);

      let eventCount1 = 0;
      let eventCount2 = 0;

      const payload1 = { channel: "test1", extra: "data1" };
      const payload2 = { channel: "test2", extra: "data2" };

      const sub1Promise = manager.subscribe("test1", payload1, () => eventCount1++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload1));
      await sub1Promise;
      socket.mockMessage(RESPONSES.channelEvent("test1", { update: "event" }));

      const sub2Promise = manager.subscribe("test2", payload2, () => eventCount2++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload2));
      await sub2Promise;
      socket.mockMessage(RESPONSES.channelEvent("test2", { update: "event" }));

      assertEquals(eventCount1, 1);
      assertEquals(eventCount2, 1);

      socket.disconnect();
      socket.open();

      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload1));
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload2));

      socket.mockMessage(RESPONSES.channelEvent("test1", { update: "event" }));
      socket.mockMessage(RESPONSES.channelEvent("test2", { update: "event" }));

      await drain();

      assertEquals(eventCount1, 2);
      assertEquals(eventCount2, 2);

      socket.terminate();
    });

    test("onError: rejected re-subscription notifies once, drops the channel, and is not retried", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      const errors: unknown[] = [];
      const subPromise = manager.subscribe("test", payload, () => {}, { onError: (e) => errors.push(e) });
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      // Reconnect, then the server rejects the re-subscription while the socket stays open.
      socket.disconnect();
      socket.open();
      socket.mockMessage(RESPONSES.errorChannel(JSON.stringify({ method: "subscribe", subscription: payload })));
      await drain();

      assertEquals(errors.length, 1);
      assert(errors[0] instanceof WebSocketRequestError);
      // The connection is still live, but the failed channel is dropped.
      assertEquals(socket.readyState, ReconnectingWebSocket.OPEN);
      assertEquals(manager._subscriptions.size, 0);

      // Next reconnect does not retry the dropped channel: no new subscribe frame, no new onError.
      const sentBefore = socket.sentMessages.length;
      socket.disconnect();
      socket.open();
      await drain();
      assertEquals(socket.sentMessages.length, sentBefore);
      assertEquals(errors.length, 1);

      // A later terminal close does not re-notify the already-dropped channel.
      socket.terminate(new Error("dead"));
      await drain();
      assertEquals(errors.length, 1);
    });

    test("a subscriber joining an in-flight resubscribe shares its failure", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      const subPromise = manager.subscribe("test", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      // Reconnect; the re-subscription is in flight when a new subscriber joins.
      socket.disconnect();
      socket.open();
      const joiner = manager.subscribe("test", payload, () => {});

      // The server rejects the re-subscription on the live socket.
      socket.mockMessage(RESPONSES.errorChannel(JSON.stringify({ method: "subscribe", subscription: payload })));

      await assertRejects(() => joiner, WebSocketRequestError);
      assertEquals(manager._subscriptions.size, 0);
    });

    test("a joiner rejected by a disconnect does not keep a zombie listener", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      let survivorEvents = 0;
      let joinerEvents = 0;
      const subPromise = manager.subscribe("test", payload, () => survivorEvents++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      // Reconnect; a joiner subscribes while the re-subscription is in flight,
      // then the connection drops again before the confirmation.
      socket.disconnect();
      socket.open();
      const joiner = manager.subscribe("test", payload, () => joinerEvents++);
      socket.disconnect();
      await assertRejects(() => joiner, WebSocketRequestError, "WebSocket connection closed");

      // The survivor keeps the entry; the joiner's listener is gone with its rejection.
      assertEquals(manager._subscriptions.size, 1);
      assertEquals(manager._subscriptions.get(JSON.stringify(payload))?.listeners.size, 1);

      socket.open();
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      socket.mockMessage(RESPONSES.channelEvent("test", { update: "x" }));
      await drain();
      assertEquals(survivorEvents, 1);
      assertEquals(joinerEvents, 0);
    });

    test("a subscriber hitting a poisoned cached rejection does not leak its listener", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      const subPromise = manager.subscribe("test", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      // The connection flaps: the re-subscription is rejected by the disconnect
      // and its rejection stays cached in the surviving entry.
      socket.disconnect();
      socket.open();
      socket.disconnect();
      await drain();

      // A subscriber in the disconnected window hits the cached rejection.
      let lateEvents = 0;
      const late = manager.subscribe("test", payload, () => lateEvents++);
      await assertRejects(() => late, WebSocketRequestError, "WebSocket connection closed");
      assertEquals(manager._subscriptions.get(JSON.stringify(payload))?.listeners.size, 1);

      socket.open();
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      socket.mockMessage(RESPONSES.channelEvent("test", { update: "x" }));
      await drain();
      assertEquals(lateEvents, 0);
    });

    test("a re-subscription rejected by a disconnect survives for the next open", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      let events = 0;
      let onErrorCalled = false;
      const subPromise = manager.subscribe("test", payload, () => events++, {
        onError: () => (onErrorCalled = true),
      });
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      // The connection flaps while the re-subscription is in flight:
      // the dispatcher rejects its queue, but the channel must survive.
      socket.disconnect();
      socket.open();
      socket.disconnect();
      await drain();

      assertFalse(onErrorCalled);
      assertEquals(manager._subscriptions.size, 1);

      // The next open retries and the channel keeps working.
      socket.open();
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      socket.mockMessage(RESPONSES.channelEvent("test", { update: "x" }));
      assertEquals(events, 1);
    });

    test("onError: terminal loss notifies every listener once with the reason, isolating throws", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      // Two listeners on one channel: the first throws after being called, the second records the reason.
      let firstCalls = 0;
      const seen: unknown[] = [];
      const p1 = manager.subscribe("test", payload, () => {}, {
        onError: () => {
          firstCalls++;
          throw new Error("boom");
        },
      });
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await p1;
      await manager.subscribe("test", payload, () => {}, { onError: (e) => seen.push(e) });

      socket.terminate(new Error("gone for good"));
      await drain();

      // The first listener's throw does not block the sibling, which receives
      // a wrapped error whose cause is the termination reason.
      assertEquals(firstCalls, 1);
      assertEquals(seen.length, 1);
      assert(seen[0] instanceof WebSocketRequestError);
      assertEquals((seen[0] as WebSocketRequestError).cause, socket.terminationSignal.reason);
      assertEquals(manager._subscriptions.size, 0);
    });

    test("onError: terminal also fires via the socket error event", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      const errors: unknown[] = [];
      const subPromise = manager.subscribe("test", payload, () => {}, { onError: (e) => errors.push(e) });
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      socket.terminationController.abort(new Error("error-path"));
      socket.dispatchEvent(new Event("error"));
      await drain();

      // The terminal-via-error failure is wrapped too, with the reason as cause.
      assertEquals(errors.length, 1);
      assert(errors[0] instanceof WebSocketRequestError);
      assertEquals((errors[0] as WebSocketRequestError).cause, socket.terminationSignal.reason);
    });

    test("onError: re-subscribing the same listener keeps its original onError (first-wins)", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      let first = 0;
      let second = 0;
      const listener = () => {};
      const p1 = manager.subscribe("test", payload, listener, { onError: () => first++ });
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await p1;

      const sentBefore = socket.sentMessages.length;
      await manager.subscribe("test", payload, listener, { onError: () => second++ }); // same listener, different onError

      assertEquals(socket.sentMessages.length, sentBefore); // no new subscribe sent (dedup)
      assertEquals(manager._subscriptions.get(JSON.stringify(payload))?.listeners.size, 1);

      socket.terminate(new Error("x"));
      await drain();

      assertEquals(first, 1); // original onError fired
      assertEquals(second, 0); // replacement ignored
    });

    test("onError: called once when the connection drops with resubscribe disabled", async () => {
      const { socket, manager } = createManager(false);
      const payload = { channel: "test", extra: "data" };

      let errorCalls = 0;
      const subPromise = manager.subscribe("test", payload, () => {}, { onError: () => errorCalls++ });
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      // Not a termination, but the subscription cannot be served anymore.
      socket.disconnect();
      await drain();

      assertEquals(manager._subscriptions.size, 0);
      assertEquals(errorCalls, 1);

      // The already-failed subscription is not re-notified on termination.
      socket.terminate();
      await drain();
      assertEquals(errorCalls, 1);
    });

    test("a failure before the confirmation rejects subscribe() without firing onError", async () => {
      const { socket, manager } = createManager(false);
      const payload = { channel: "test", extra: "data" };

      let errorCalls = 0;
      const subPromise = manager.subscribe("test", payload, () => {}, { onError: () => errorCalls++ });

      socket.disconnect();
      await assertRejects(() => subPromise, WebSocketRequestError, "WebSocket connection closed");
      await drain();

      // One failure, one reporting channel: the rejection. No onError.
      assertEquals(errorCalls, 0);
      assertEquals(manager._subscriptions.size, 0);
    });

    test("a termination before the confirmation rejects subscribe() without firing onError", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      let errorCalls = 0;
      const subPromise = manager.subscribe("test", payload, () => {}, { onError: () => errorCalls++ });

      socket.terminate(new Error("gone"));
      await assertRejects(() => subPromise, WebSocketRequestError);
      await drain();

      assertEquals(errorCalls, 0);
      assertEquals(manager._subscriptions.size, 0);
    });

    test("disabling resubscribe while disconnected fails the stranded subscriptions at open", async () => {
      const { socket, manager } = createManager(true);
      const payload = { channel: "test", extra: "data" };

      const errors: unknown[] = [];
      let events = 0;
      const subPromise = manager.subscribe("test", payload, () => events++, { onError: (e) => errors.push(e) });
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await subPromise;

      // The subscription survives the drop, but re-subscription is switched
      // off while the socket is down — it cannot be served after the reopen.
      socket.disconnect();
      manager.resubscribe = false;
      const sentBefore = socket.sentMessages.length;
      socket.open();
      await drain();

      assertEquals(socket.sentMessages.length, sentBefore);
      assertEquals(errors.length, 1);
      assert(errors[0] instanceof WebSocketRequestError);
      assertEquals(manager._subscriptions.size, 0);

      socket.mockMessage(RESPONSES.channelEvent("test", { update: "x" }));
      assertEquals(events, 0);
    });

    test("resubscribe: false clears subscriptions on close", async () => {
      const { socket, manager } = createManager(false);

      let eventCount1 = 0;
      let eventCount2 = 0;

      const payload1 = { channel: "test1", extra: "data1" };
      const payload2 = { channel: "test2", extra: "data2" };

      const sub1Promise = manager.subscribe("test1", payload1, () => eventCount1++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload1));
      await sub1Promise;
      socket.mockMessage(RESPONSES.channelEvent("test1", { update: "event" }));

      const sub2Promise = manager.subscribe("test2", payload2, () => eventCount2++);
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload2));
      await sub2Promise;
      socket.mockMessage(RESPONSES.channelEvent("test2", { update: "event" }));

      assertEquals(eventCount1, 1);
      assertEquals(eventCount2, 1);
      assertEquals(manager._subscriptions.size, 2);

      socket.disconnect();
      await drain();

      assertEquals(manager._subscriptions.size, 0);

      // After the reopen no resubscription happens and no events are delivered.
      socket.open();
      socket.mockMessage(RESPONSES.channelEvent("test1", { update: "event" }));
      socket.mockMessage(RESPONSES.channelEvent("test2", { update: "event" }));
      await drain();

      assertEquals(eventCount1, 1);
      assertEquals(eventCount2, 1);

      socket.terminate();
    });
  });

  describe("unique user subscription limit", () => {
    test("rejects when exceeding 15 unique users", async () => {
      const { socket, manager } = createManager();

      for (let i = 0; i < 15; i++) {
        const payload = { type: "userEvents", user: `0x${i.toString().padStart(40, "0")}` };
        const promise = manager.subscribe("userEvents", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      const payload16 = { type: "userEvents", user: "0x000000000000000000000000000000000000000f" };
      await assertRejects(
        () => manager.subscribe("userEvents", payload16, () => {}),
        WebSocketRequestError,
        "Cannot track more than 15 total users.",
      );
    });

    test("allows subscription after unsubscribing", async () => {
      const { socket, manager } = createManager();

      const subs = [];
      for (let i = 0; i < 15; i++) {
        const payload = { type: "userEvents", user: `0x${i.toString().padStart(40, "0")}` };
        const promise = manager.subscribe("userEvents", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        subs.push({ sub: await promise, payload });
      }

      const unsubPromise = subs[0].sub.unsubscribe();
      socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", subs[0].payload));
      await unsubPromise;

      const newUserPayload = { type: "userEvents", user: "0x000000000000000000000000000000000000000f" };
      const promise = manager.subscribe("userEvents", newUserPayload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", newUserPayload));
      await promise;

      assertEquals(manager._subscriptions.size, 15);
    });

    test("does not count subscriptions without user parameter", async () => {
      const { socket, manager } = createManager();

      for (let i = 0; i < 10; i++) {
        const payload = { type: "allMids" };
        const promise = manager.subscribe("allMids", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      const userPayload = { type: "userEvents", user: "0x0000000000000000000000000000000000000001" };
      const promise = manager.subscribe("userEvents", userPayload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", userPayload));
      await promise;
    });

    test("allows a new channel of an already tracked user at the limit", async () => {
      const { socket, manager } = createManager();

      for (let i = 0; i < 15; i++) {
        const payload = { type: "userEvents", user: `0x${i.toString().padStart(40, "0")}` };
        const promise = manager.subscribe("userEvents", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      // A new channel of user 0 does not add a 16th user.
      const payload = { type: "userFills", user: `0x${"0".padStart(40, "0")}` };
      const promise = manager.subscribe("userFills", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await promise;
    });

    test("matches tracked users case-insensitively", async () => {
      const { socket, manager } = createManager();

      const mixedCase = "0x00000000000000000000000000000000000000AB";
      for (const user of [mixedCase, ...Array.from({ length: 14 }, (_, i) => `0x${`${i}`.padStart(40, "0")}`)]) {
        const payload = { type: "userEvents", user };
        const promise = manager.subscribe("userEvents", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      // The same address in a different case is not a 16th user.
      const payload = { type: "userFills", user: mixedCase.toLowerCase() };
      const promise = manager.subscribe("userFills", payload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
      await promise;
    });

    test("allows multiple listeners on same user subscription", async () => {
      const { socket, manager } = createManager();

      for (let i = 0; i < 15; i++) {
        const payload = { type: "userEvents", user: `0x${i.toString().padStart(40, "0")}` };
        const promise = manager.subscribe("userEvents", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      const existingPayload = { type: "userEvents", user: "0x0000000000000000000000000000000000000000" };
      await manager.subscribe("userEvents", existingPayload, () => {});
    });

    test("allows multiple subscriptions for same user", async () => {
      const { socket, manager } = createManager();

      // Many channels of one user count as a single unique user.
      const user = "0x0000000000000000000000000000000000000001";
      for (let i = 0; i < 10; i++) {
        const payload = { type: `channel${i}`, user };
        const promise = manager.subscribe(`channel${i}`, payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      const newUserPayload = { type: "userEvents", user: "0x0000000000000000000000000000000000000002" };
      const promise = manager.subscribe("userEvents", newUserPayload, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", newUserPayload));
      await promise;

      assertEquals(manager._subscriptions.size, 11);
    });

    test("mutating the payload after subscribing corrupts neither the unsubscribe nor the user guard", async () => {
      const { socket, manager } = createManager();

      const subs = [];
      for (let i = 0; i < 15; i++) {
        const payload = { type: "userEvents", user: `0x${i.toString().padStart(40, "0")}` };
        const promise = manager.subscribe("userEvents", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        subs.push({ sub: await promise, payload });
      }

      // The caller still owns the object it passed and mutates it before unsubscribing.
      subs[0].payload.user = "0x00000000000000000000000000000000000000ff";

      const unsubPromise = subs[0].sub.unsubscribe();
      // The unsubscribe goes out with the payload as subscribed, not as mutated.
      assertEquals(JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]).subscription, {
        type: "userEvents",
        user: "0x0000000000000000000000000000000000000000",
      });
      socket.mockMessage(
        RESPONSES.subscriptionResponse("unsubscribe", {
          type: "userEvents",
          user: "0x0000000000000000000000000000000000000000",
        }),
      );
      await unsubPromise;

      // The original user's slot was released: a 16th unique user fits again.
      const payload16 = { type: "userEvents", user: "0x000000000000000000000000000000000000000f" };
      const promise = manager.subscribe("userEvents", payload16, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload16));
      await promise;
    });
  });

  describe("subscription limit", () => {
    test("rejects when exceeding 1000 subscriptions", async () => {
      const { socket, manager } = createManager();

      for (let i = 0; i < 1000; i++) {
        const payload = { type: "allMids", id: i };
        const promise = manager.subscribe("allMids", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      const payload1001 = { type: "allMids", id: 1000 };
      await assertRejects(
        () => manager.subscribe("allMids", payload1001, () => {}),
        WebSocketRequestError,
        "Cannot subscribe to more than 1000 channels.",
      );
    });

    test("allows subscription after unsubscribing", async () => {
      const { socket, manager } = createManager();

      const subs = [];
      for (let i = 0; i < 1000; i++) {
        const payload = { type: "allMids", id: i };
        const promise = manager.subscribe("allMids", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        subs.push({ sub: await promise, payload });
      }

      const unsubPromise = subs[0].sub.unsubscribe();
      socket.mockMessage(RESPONSES.subscriptionResponse("unsubscribe", subs[0].payload));
      await unsubPromise;

      const payload1001 = { type: "allMids", id: 1000 };
      const promise = manager.subscribe("allMids", payload1001, () => {});
      socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload1001));
      await promise;

      assertEquals(manager._subscriptions.size, 1000);
    });

    test("allows multiple listeners on same subscription", async () => {
      const { socket, manager } = createManager();

      for (let i = 0; i < 1000; i++) {
        const payload = { type: "allMids", id: i };
        const promise = manager.subscribe("allMids", payload, () => {});
        socket.mockMessage(RESPONSES.subscriptionResponse("subscribe", payload));
        await promise;
      }

      const existingPayload = { type: "allMids", id: 0 };
      await manager.subscribe("allMids", existingPayload, () => {});

      assertEquals(manager._subscriptions.size, 1000);
    });
  });
});
