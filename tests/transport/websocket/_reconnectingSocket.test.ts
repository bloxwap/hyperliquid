/**
 * Tests for the reconnecting WebSocket: retry policy, backoff scheduling,
 * offline buffering, and termination semantics, driven by a fake global
 * `WebSocket` the tests steer by hand.
 * @module
 */

import { afterEach, beforeEach, describe, test } from "bun:test";
import { assert, assertEquals, assertFalse, assertInstanceOf } from "@jsr/std__assert";
import { FakeTime } from "@jsr/std__testing/time";
import {
  ReconnectingWebSocket,
  ReconnectingWebSocketError,
  type ReconnectingWebSocketOptions,
} from "../../../src/transport/websocket/_reconnectingSocket.ts";
import { drain } from "./_mock.ts";

// =============================================================================
// Fake WebSocket
// =============================================================================

/** In-memory `WebSocket` stand-in installed over the global; the test drives its lifecycle. */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readonly protocols: string | string[] | undefined;
  readyState = 0;
  bufferedAmount = 0;
  binaryType: "blob" | "arraybuffer" = "blob";
  extensions = "";
  protocol = "";
  sent: unknown[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    if (this.readyState !== 1) throw new Error("FakeWebSocket is not open");
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.readyState >= 2) return;
    this.readyState = 3;
    // Stale by the time it fires (the wrapper detaches before calling close()), so timing is irrelevant.
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }));
  }

  /** Simulates the handshake completing. */
  serverOpen(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  /** Simulates an inbound frame. */
  serverMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  /** Simulates a transport-level failure: an `error` event followed by `close`. */
  serverError(): void {
    this.dispatchEvent(new Event("error"));
  }

  /** Simulates the connection dropping. */
  serverClose(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
}

const OriginalWebSocket = globalThis.WebSocket;

/** The most recently created fake socket. */
function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  assert(socket !== undefined, "expected a WebSocket connection attempt");
  return socket;
}

/** Wrappers created by {@linkcode createSocket}, terminated in `afterEach` so no retry timer outlives its test. */
const liveSockets: ReconnectingWebSocket[] = [];

/** Creates a wrapper with fast, deterministic defaults for testing. */
function createSocket(
  url: string | URL | (() => string | URL | Promise<string | URL>) = "ws://localhost/ws",
  options?: ReconnectingWebSocketOptions,
): ReconnectingWebSocket {
  const ws = new ReconnectingWebSocket(url, { reconnectionDelay: 0, ...options });
  liveSockets.push(ws);
  return ws;
}

/** Sleeps for real milliseconds (no fake timers installed). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Tests
// =============================================================================

describe("ReconnectingWebSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    // Terminate anything still live: a pending retry timer would otherwise fire inside a
    // later test and register its connection attempt against that test's instance list.
    for (const ws of liveSockets.splice(0)) ws.close();
    globalThis.WebSocket = OriginalWebSocket;
  });

  describe("connection and events", () => {
    test("connects immediately and redispatches open and message", async () => {
      const ws = createSocket();
      assertEquals(ws.readyState, ReconnectingWebSocket.CONNECTING);
      assertEquals(FakeWebSocket.instances.length, 1);

      const events: string[] = [];
      ws.addEventListener("open", () => events.push("open"));
      ws.addEventListener("message", (event) => events.push(`message:${event.data}`));

      lastSocket().serverOpen();
      assertEquals(ws.readyState, ReconnectingWebSocket.OPEN);
      lastSocket().serverMessage("hello");

      assertEquals(events, ["open", "message:hello"]);
      ws.close();
    });

    test("resolves the url through an async factory before connecting", async () => {
      const ws = createSocket(() => Promise.resolve("ws://localhost/from-factory"));
      assertEquals(ws.url, "");
      assertEquals(FakeWebSocket.instances.length, 0);

      await drain();
      assertEquals(FakeWebSocket.instances.length, 1);
      assertEquals(lastSocket().url, "ws://localhost/from-factory");
      assertEquals(ws.url, "ws://localhost/from-factory");
      ws.close();
    });

    test("redispatches error events from the underlying socket", () => {
      const ws = createSocket();
      let errors = 0;
      ws.addEventListener("error", () => errors++);

      lastSocket().serverError();
      assertEquals(errors, 1);
      ws.close();
    });
  });

  describe("send buffering", () => {
    test("buffers while connecting and flushes in order on open", () => {
      const ws = createSocket();
      ws.send("a");
      ws.send("b");
      assertEquals(lastSocket().sent, []);

      lastSocket().serverOpen();
      assertEquals(lastSocket().sent, ["a", "b"]);

      ws.send("c");
      assertEquals(lastSocket().sent, ["a", "b", "c"]);
      ws.close();
    });

    test("drops sends beyond maxEnqueuedMessages silently", () => {
      const ws = createSocket("ws://localhost/ws", { maxEnqueuedMessages: 2 });
      ws.send("a");
      ws.send("b");
      ws.send("c"); // over the cap: silently dropped

      lastSocket().serverOpen();
      assertEquals(lastSocket().sent, ["a", "b"]);
      ws.close();
    });

    test("buffers across a reconnect and flushes on the new socket", async () => {
      const ws = createSocket();
      lastSocket().serverOpen();
      lastSocket().serverClose();

      ws.send("while-down");
      await drain();
      assertEquals(FakeWebSocket.instances.length, 2);

      lastSocket().serverOpen();
      assertEquals(lastSocket().sent, ["while-down"]);
      ws.close();
    });

    test("discards sends after permanent termination", () => {
      const ws = createSocket();
      lastSocket().serverOpen();
      ws.close();

      ws.send("too-late");
      assertEquals(lastSocket().sent, []);
    });
  });

  describe("reconnection", () => {
    test("reconnects after a server close and fires open again", async () => {
      const ws = createSocket();
      lastSocket().serverOpen();

      const events: string[] = [];
      ws.addEventListener("close", () => events.push("close"));
      ws.addEventListener("open", () => events.push("open"));

      lastSocket().serverClose(1001, "going away");
      assertEquals(events, ["close"]);
      assertEquals(ws.readyState, ReconnectingWebSocket.CONNECTING);
      assertEquals(ws.retryCount, 1);

      await drain();
      assertEquals(FakeWebSocket.instances.length, 2);

      lastSocket().serverOpen();
      assertEquals(events, ["close", "open"]);
      assertEquals(ws.readyState, ReconnectingWebSocket.OPEN);
      ws.close();
    });

    test("passes 0-based attempt numbers to reconnectionDelay", async () => {
      const attempts: number[] = [];
      const ws = createSocket("ws://localhost/ws", {
        maxRetries: 3,
        reconnectionDelay: (attempt) => {
          attempts.push(attempt);
          return 0;
        },
      });

      // maxRetries allows 3 retries; the 4th consecutive failure terminates.
      for (let i = 0; i < 4; i++) {
        lastSocket().serverClose();
        await drain();
      }

      assertEquals(attempts, [0, 1, 2]);
      assert(ws.terminationSignal.aborted);
      ws.close();
    });

    test("default delay is exponential backoff with equal jitter, capped at 10s", () => {
      const time = new FakeTime();
      try {
        const ws = new ReconnectingWebSocket("ws://localhost/ws");
        lastSocket().serverClose();
        // attempt 0: 2**0 * 150 = 150 → delay in [75, 150)
        time.tick(74);
        assertEquals(FakeWebSocket.instances.length, 1);
        time.tick(76);
        assertEquals(FakeWebSocket.instances.length, 2);

        lastSocket().serverClose();
        // attempt 1: 2**1 * 150 = 300 → delay in [150, 300)
        time.tick(149);
        assertEquals(FakeWebSocket.instances.length, 2);
        time.tick(151);
        assertEquals(FakeWebSocket.instances.length, 3);
        ws.close();
      } finally {
        time.restore();
      }
    });

    test("retry counter resets after the connection stays open for stableTimeout", async () => {
      const ws = createSocket("ws://localhost/ws", { stableTimeout: 5 });
      lastSocket().serverOpen();
      await sleep(10);

      lastSocket().serverClose();
      assertEquals(ws.retryCount, 1); // first failure of a fresh streak
      ws.close();
    });

    test("retry counter keeps counting when connections drop before stableTimeout", async () => {
      const ws = createSocket("ws://localhost/ws", { stableTimeout: 60_000 });
      lastSocket().serverOpen();
      lastSocket().serverClose();
      await drain();
      lastSocket().serverClose();
      assertEquals(ws.retryCount, 2);
      ws.close();
    });

    test("connection timeout recycles a stuck handshake", async () => {
      const ws = createSocket("ws://localhost/ws", { connectionTimeout: 5 });
      assertEquals(FakeWebSocket.instances.length, 1);

      // Every attempt that stays stuck past the timeout fails and is retried, so within one
      // sleep more than one attempt may cycle — what matters is that fresh attempts happen.
      await sleep(15);
      assert(FakeWebSocket.instances.length >= 2);
      assert(ws.retryCount >= 1);

      lastSocket().serverOpen();
      assertEquals(ws.readyState, ReconnectingWebSocket.OPEN);
      ws.close();
    });
  });

  describe("permanent termination", () => {
    test("shouldReconnect returning false terminates with RECONNECTION_DECLINED", () => {
      const seen: { code: number; attempt: number }[] = [];
      const ws = createSocket("ws://localhost/ws", {
        shouldReconnect: (event, attempt) => {
          seen.push({ code: event.code, attempt });
          return false;
        },
      });
      lastSocket().serverOpen();

      const closes: CloseEvent[] = [];
      ws.addEventListener("close", (event) => closes.push(event));

      lastSocket().serverClose(1001);

      assertEquals(seen, [{ code: 1001, attempt: 0 }]);
      assert(ws.terminationSignal.aborted);
      const reason = ws.terminationSignal.reason;
      assertInstanceOf(reason, ReconnectingWebSocketError);
      assertEquals(reason.code, "RECONNECTION_DECLINED");
      // The signal is already aborted when the final close reaches listeners.
      assertEquals(closes.length, 1);
      assertEquals(ws.readyState, ReconnectingWebSocket.CLOSED);
      assertEquals(FakeWebSocket.instances.length, 1);
    });

    test("maxRetries exhaustion terminates with RECONNECTION_LIMIT", async () => {
      const ws = createSocket("ws://localhost/ws", { maxRetries: 2 });

      let closesWhileTerminated = 0;
      ws.addEventListener("close", () => {
        if (ws.terminationSignal.aborted) closesWhileTerminated++;
      });

      lastSocket().serverClose();
      await drain();
      assertFalse(ws.terminationSignal.aborted);
      lastSocket().serverClose();
      await drain();
      assertFalse(ws.terminationSignal.aborted);
      lastSocket().serverClose(); // third consecutive failure: over maxRetries

      assert(ws.terminationSignal.aborted);
      const reason = ws.terminationSignal.reason;
      assertInstanceOf(reason, ReconnectingWebSocketError);
      assertEquals(reason.code, "RECONNECTION_LIMIT");
      assertEquals(closesWhileTerminated, 1);
      assertEquals(FakeWebSocket.instances.length, 3);
    });

    test("a throwing shouldReconnect terminates with UNKNOWN_ERROR", () => {
      const boom = new Error("boom");
      const ws = createSocket("ws://localhost/ws", {
        shouldReconnect: () => {
          throw boom;
        },
      });

      lastSocket().serverClose();

      assert(ws.terminationSignal.aborted);
      const reason = ws.terminationSignal.reason;
      assertInstanceOf(reason, ReconnectingWebSocketError);
      assertEquals(reason.code, "UNKNOWN_ERROR");
      assertEquals(reason.cause, boom);
    });

    test("close() terminates synchronously", () => {
      const ws = createSocket();
      lastSocket().serverOpen();

      const closes: CloseEvent[] = [];
      ws.addEventListener("close", (event) => closes.push(event));

      ws.close(4000, "done");

      // Everything settled before close() returned.
      assert(ws.terminationSignal.aborted);
      const reason = ws.terminationSignal.reason;
      assertInstanceOf(reason, ReconnectingWebSocketError);
      assertEquals(reason.code, "TERMINATED_BY_USER");
      assertEquals(ws.readyState, ReconnectingWebSocket.CLOSED);
      assertEquals(closes.length, 1);
      assertEquals(closes[0].code, 4000);
      assertEquals(closes[0].reason, "done");
      assertEquals(lastSocket().closeCalls, [{ code: 4000, reason: "done" }]);

      ws.close(); // idempotent
      assertEquals(closes.length, 1);
    });

    test("close() from within a close listener dispatches no second close", async () => {
      const ws = createSocket();

      let closes = 0;
      ws.addEventListener("close", () => {
        closes++;
        ws.close();
      });

      lastSocket().serverClose();

      assert(ws.terminationSignal.aborted);
      assertEquals(closes, 1);
      await drain();
      assertEquals(FakeWebSocket.instances.length, 1); // no reconnect scheduled
    });
  });

  describe("reconnect()", () => {
    test("drops the current connection and reconnects immediately", async () => {
      const ws = createSocket();
      lastSocket().serverOpen();
      const oldSocket = lastSocket();

      const events: string[] = [];
      ws.addEventListener("close", () => events.push("close"));
      ws.addEventListener("open", () => events.push("open"));

      ws.reconnect(4001, "refresh");

      assertEquals(events, ["close"]);
      assertEquals(oldSocket.closeCalls, [{ code: 4001, reason: "refresh" }]);
      assertEquals(FakeWebSocket.instances.length, 2);
      assertEquals(ws.retryCount, 0); // user-initiated: not counted as a retry

      lastSocket().serverOpen();
      assertEquals(events, ["close", "open"]);
      assertEquals(ws.readyState, ReconnectingWebSocket.OPEN);
      ws.close();
    });

    test("skips a pending retry delay", async () => {
      const ws = createSocket("ws://localhost/ws", { reconnectionDelay: 60_000 });
      lastSocket().serverClose();
      assertEquals(FakeWebSocket.instances.length, 1);

      ws.reconnect();
      assertEquals(FakeWebSocket.instances.length, 2);
      ws.close();
    });

    test("does nothing once terminated", () => {
      const ws = createSocket();
      ws.close();

      ws.reconnect();
      assertEquals(FakeWebSocket.instances.length, 1);
    });
  });
});
