/**
 * Tests for the typed event target: routing of Hyperliquid envelopes and
 * explorer pushes, and tolerance to malformed frames.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@jsr/std__assert";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";
import { payloadEventType } from "../../../src/transport/websocket/_routing.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Creates a fake WebSocket for testing. */
function createFakeSocket(): WebSocket {
  return new EventTarget() as WebSocket;
}

/** Dispatches a message event to the socket. */
function dispatchMessage(socket: WebSocket, data: string): void {
  socket.dispatchEvent(new MessageEvent("message", { data }));
}

// =============================================================================
// Test Data
// =============================================================================

const MESSAGES = {
  hyperliquidEvent: {
    channel: "testChannel",
    data: { foo: "bar" },
  },
  explorerBlock: [
    {
      blockTime: 1678900000,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      height: 123,
      numTxs: 42,
      proposer: "0x0000000000000000000000000000000000000000",
    },
  ],
  explorerTxs: [
    {
      action: { type: "someAction" },
      block: 234,
      error: null,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      time: 1678900001,
      user: "0x0000000000000000000000000000000000000000",
    },
  ],
} as const;

// =============================================================================
// Tests
// =============================================================================

describe("HyperliquidEventTarget", () => {
  describe("message parsing", () => {
    test("HyperliquidEvent dispatches to channel name", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let received: unknown;
      target.addEventListener(MESSAGES.hyperliquidEvent.channel, (e) => {
        received = e.detail;
      });

      dispatchMessage(socket, JSON.stringify(MESSAGES.hyperliquidEvent));
      assertEquals(received, MESSAGES.hyperliquidEvent.data);
    });

    test("ExplorerBlock dispatches to explorerBlock_", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let received: unknown;
      target.addEventListener("explorerBlock_", (e) => {
        received = e.detail;
      });

      dispatchMessage(socket, JSON.stringify(MESSAGES.explorerBlock));
      assertEquals(received, MESSAGES.explorerBlock);
    });

    test("ExplorerTxs dispatches to explorerTxs_", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let received: unknown;
      target.addEventListener("explorerTxs_", (e) => {
        received = e.detail;
      });

      dispatchMessage(socket, JSON.stringify(MESSAGES.explorerTxs));
      assertEquals(received, MESSAGES.explorerTxs);
    });

    test("pong dispatches to pong channel", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let received = false;
      target.addEventListener("pong", () => {
        received = true;
      });

      dispatchMessage(socket, '{"channel":"pong"}');
      assert(received);
    });
  });

  describe("routed dispatch", () => {
    test("a routed frame reaches only the matching route", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      const seen: string[] = [];
      for (const coin of ["BTC", "ETH"]) {
        target.addEventListener(payloadEventType("l2Book", { type: "l2Book", coin }), () => seen.push(coin));
      }

      dispatchMessage(socket, JSON.stringify({ channel: "l2Book", data: { coin: "ETH", levels: [] } }));
      assertEquals(seen, ["ETH"]);
    });

    test("a listener on the bare channel still receives routed frames", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let broadcast = 0;
      let routed = 0;
      target.addEventListener("l2Book", () => broadcast++);
      target.addEventListener(payloadEventType("l2Book", { type: "l2Book", coin: "BTC" }), () => routed++);

      dispatchMessage(socket, JSON.stringify({ channel: "l2Book", data: { coin: "BTC", levels: [] } }));
      assertEquals(broadcast, 1);
      assertEquals(routed, 1);
    });

    test("a frame without a route key still reaches the bare channel", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      // A coinless l2Book frame cannot be keyed: it goes out on the channel only, which is where
      // every subscription that could not be keyed listens.
      let broadcast = 0;
      let routed = 0;
      target.addEventListener("l2Book", () => broadcast++);
      target.addEventListener(payloadEventType("l2Book", { type: "l2Book", coin: "BTC" }), () => routed++);

      dispatchMessage(socket, JSON.stringify({ channel: "l2Book", data: { levels: [] } }));
      assertEquals(broadcast, 1);
      assertEquals(routed, 0);
    });

    test("an unrouted channel keeps broadcast semantics", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let calls = 0;
      target.addEventListener("allMids", () => calls++);
      target.addEventListener("allMids", () => calls++); // a second, distinct listener

      dispatchMessage(socket, JSON.stringify({ channel: "allMids", data: { mids: {} } }));
      assertEquals(calls, 2);
    });
  });

  describe("error handling", () => {
    test("invalid JSON does not crash", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let triggered = false;
      target.addEventListener("anything", () => {
        triggered = true;
      });

      dispatchMessage(socket, "{ invalid json ...");
      assertFalse(triggered);
    });

    test("unrecognized message shape is ignored", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let triggered = false;
      target.addEventListener("someChannel", () => {
        triggered = true;
      });

      dispatchMessage(socket, '{"foo":"bar"}');
      assertFalse(triggered);
    });

    test("garbage frames never throw out of the handler and leave listeners intact", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let received = 0;
      target.addEventListener("l2Book", () => received++);

      const garbage = [
        "not json",
        "12345",
        '"just a string"',
        "null",
        "true",
        "{}",
        "[]",
        "[1,2,3]",
        '[{"blockTime":1}]', // partial explorer block
        '{"channel":123,"data":{}}', // channel not a string
        '{"channel":["l2Book"],"data":{}}', // channel not a string
        '{"channel":"error","data":1e1000}', // huge number (Infinity)
        "   ", // whitespace only
        "", // empty frame
      ];
      for (const frame of garbage) {
        dispatchMessage(socket, frame); // must not throw
      }
      assertEquals(received, 0);

      // Subsequent valid frames still dispatch.
      dispatchMessage(socket, JSON.stringify({ channel: "l2Book", data: { coin: "BTC", levels: [] } }));
      assertEquals(received, 1);
    });

    test("a throwing listener neither kills the handler nor starves the other listeners", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      // Bun and Node raise a listener's synchronous throw as an uncaught error, which would
      // kill the process and skip the remaining listeners; the guard contains it instead.
      let survived = 0;
      target.addEventListener("testChannel", () => {
        throw new Error("bug in a listener");
      });
      target.addEventListener("testChannel", () => survived++);

      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
      assertEquals(survived, 1);

      // The throwing listener stays registered and contained on later frames too.
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
      assertEquals(survived, 2);
    });

    test("a removed listener stays removed despite the guard wrapper", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let calls = 0;
      const listener = (): void => {
        calls++;
      };
      target.addEventListener("testChannel", listener);
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));

      target.removeEventListener("testChannel", listener);
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));

      assertEquals(calls, 1);
    });

    test("addEventListener({ once: true }) fires once then detaches (function listener)", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let calls = 0;
      target.addEventListener("testChannel", () => calls++, { once: true });

      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: { n: 1 } }));
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: { n: 2 } }));
      assertEquals(calls, 1);
    });

    test("addEventListener({ once: true }) fires once then detaches (EventListenerObject)", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let calls = 0;
      const listener: EventListenerObject = {
        handleEvent() {
          calls++;
        },
      };
      target.addEventListener("testChannel", listener, { once: true });

      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
      assertEquals(calls, 1);
    });

    test("addEventListener with an already-aborted signal never delivers", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      const signal = AbortSignal.abort();

      let calls = 0;
      target.addEventListener("testChannel", () => calls++, { signal });
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
      assertEquals(calls, 0);
    });

    test("addEventListener signal abort detaches a live listener", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      const controller = new AbortController();

      let calls = 0;
      target.addEventListener("testChannel", () => calls++, { signal: controller.signal });
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
      assertEquals(calls, 1);

      controller.abort();
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
      assertEquals(calls, 1);
    });

    test("null listener is a no-op for add and remove", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      target.addEventListener("testChannel", null);
      target.removeEventListener("testChannel", null);
      // No throw, and no listener to fire.
      dispatchMessage(socket, JSON.stringify({ channel: "testChannel", data: {} }));
    });

    test("EventListenerObject is invoked via handleEvent on single- and multi-listener channels", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      let a = 0;
      let b = 0;
      target.addEventListener("solo", {
        handleEvent() {
          a++;
        },
      });
      target.addEventListener("multi", {
        handleEvent() {
          b++;
        },
      });
      target.addEventListener("multi", () => b++);

      dispatchMessage(socket, JSON.stringify({ channel: "solo", data: {} }));
      dispatchMessage(socket, JSON.stringify({ channel: "multi", data: {} }));
      assertEquals(a, 1);
      assertEquals(b, 2);
    });
  });

  describe("listener registry", () => {
    /** Dispatches on `channel` and returns the labels the listeners recorded. */
    function emit(socket: WebSocket, channel: string): void {
      dispatchMessage(socket, JSON.stringify({ channel, data: {} }));
    }

    test("fan-out follows registration order", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      const seen: string[] = [];
      for (const name of ["a", "b", "c"]) target.addEventListener("chan", () => seen.push(name));

      emit(socket, "chan");
      assertEquals(seen, ["a", "b", "c"]);
    });

    test("registering the same listener twice fires it once", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      let calls = 0;
      const listener = (): void => {
        calls++;
      };
      target.addEventListener("chan", listener);
      target.addEventListener("chan", listener);

      emit(socket, "chan");
      assertEquals(calls, 1);
    });

    test("a listener unsubscribed by an earlier listener does not receive the in-flight frame", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      const seen: string[] = [];
      const second = (): void => {
        seen.push("second");
      };
      target.addEventListener("chan", () => {
        seen.push("first");
        target.removeEventListener("chan", second);
      });
      target.addEventListener("chan", second);

      emit(socket, "chan");
      // Matches EventTarget: removal during dispatch takes effect immediately.
      assertEquals(seen, ["first"]);
    });

    test("a listener added during dispatch skips the in-flight frame and runs on the next", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      const seen: string[] = [];
      let added = false;
      target.addEventListener("chan", () => {
        seen.push("first");
        if (added) return;
        added = true;
        target.addEventListener("chan", () => seen.push("late"));
      });

      emit(socket, "chan");
      assertEquals(seen, ["first"]);
      emit(socket, "chan");
      assertEquals(seen, ["first", "first", "late"]);
    });

    test("a listener that removes itself stops receiving frames", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      let calls = 0;
      const self = (): void => {
        calls++;
        target.removeEventListener("chan", self);
      };
      target.addEventListener("chan", self);

      emit(socket, "chan");
      emit(socket, "chan");
      assertEquals(calls, 1);
    });

    test("removing listeners down to one and back up keeps the right set live", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      const seen: string[] = [];
      const a = (): void => void seen.push("a");
      const b = (): void => void seen.push("b");
      const c = (): void => void seen.push("c");

      target.addEventListener("chan", a);
      target.addEventListener("chan", b);
      target.addEventListener("chan", c);
      target.removeEventListener("chan", b); // 3 listeners -> 2
      emit(socket, "chan");
      target.removeEventListener("chan", a); // 2 -> 1, back to the unboxed form
      emit(socket, "chan");
      target.removeEventListener("chan", c); // 1 -> 0, entry dropped
      emit(socket, "chan");
      target.addEventListener("chan", a); // re-registering from empty
      emit(socket, "chan");

      assertEquals(seen, ["a", "c", "c", "a"]);
    });

    test("removing a listener that was never registered leaves the live one alone", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      const seen: string[] = [];
      const live = (): void => void seen.push("live");
      target.addEventListener("chan", live);

      target.removeEventListener("chan", () => {});
      target.removeEventListener("otherChan", live);

      emit(socket, "chan");
      assertEquals(seen, ["live"]);
    });

    test("`once` fires exactly one frame", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);
      let calls = 0;
      target.addEventListener("chan", () => calls++, { once: true });

      emit(socket, "chan");
      emit(socket, "chan");
      assertEquals(calls, 1);
    });

    test("an AbortSignal detaches the listener, and an already-aborted one never attaches", () => {
      const socket = createFakeSocket();
      const target = new HyperliquidEventTarget(socket);

      const controller = new AbortController();
      let live = 0;
      target.addEventListener("chan", () => live++, { signal: controller.signal });
      emit(socket, "chan");
      controller.abort();
      emit(socket, "chan");
      assertEquals(live, 1);

      let never = 0;
      target.addEventListener("chan", () => never++, { signal: AbortSignal.abort() });
      emit(socket, "chan");
      assertEquals(never, 0);
    });
  });
});
