/**
 * Tests for the WebSocket keep-alive watchdog: the ping cadence, the pong
 * deadline, and the watchdog teardown on disconnect.
 * @module
 */

import { beforeEach, describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import type { ReconnectingWebSocket } from "../../../src/transport/websocket/_reconnectingSocket.ts";
import { WebSocketKeepAlive, type WebSocketKeepAliveOptions } from "../../../src/transport/websocket/_keepAlive.ts";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";
import { FakeRuntime } from "../../_fakeRuntime.ts";
import { getLastSent, MockWebSocket } from "./_mock.ts";

/** Creates a keep-alive watchdog over a mock socket, scheduling on the given virtual clock. */
function createKeepAlive(clock: FakeRuntime, options?: WebSocketKeepAliveOptions): { socket: MockWebSocket } {
  const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
  const hlEvents = new HyperliquidEventTarget(socket);
  new WebSocketKeepAlive(socket, hlEvents, options, undefined, clock);
  return { socket };
}

describe("WebSocketKeepAlive", () => {
  // Ping interval and pong deadline run on an injected virtual clock; no global timer is patched.
  let clock: FakeRuntime;

  beforeEach(() => {
    clock = new FakeRuntime();
  });

  test("reconnects when a ping stays unanswered", () => {
    const { socket } = createKeepAlive(clock);

    socket.open();
    clock.advance(5_000);
    assertEquals(getLastSent(socket).method, "ping");

    clock.advance(3_000);
    assertEquals(socket.reconnectCalls, 1);
  });

  test("a pong in time keeps the connection", () => {
    const { socket } = createKeepAlive(clock);

    socket.open();
    clock.advance(5_000);
    socket.mockMessage({ channel: "pong" });

    clock.advance(3_000);
    assertEquals(socket.reconnectCalls, 0);
  });

  test("disconnect clears the watchdog", () => {
    const { socket } = createKeepAlive(clock);

    socket.open();
    clock.advance(5_000);
    socket.disconnect();

    assertEquals(clock.pendingTimers, 0); // interval and pong deadline both released
    const sentBeforeTick = socket.sentMessages.length;
    clock.advance(60_000);
    assertEquals(socket.reconnectCalls, 0);
    assertEquals(socket.sentMessages.length, sentBeforeTick);
  });

  test("a socket error also clears the watchdog", () => {
    const { socket } = createKeepAlive(clock);

    socket.open();
    clock.advance(5_000);
    // The error listener is a distinct arrow from the close handler — both call `_stop`.
    socket.dispatchEvent(new Event("error"));

    assertEquals(clock.pendingTimers, 0); // interval and pong deadline both released
    const sentBeforeTick = socket.sentMessages.length;
    clock.advance(60_000);
    assertEquals(socket.reconnectCalls, 0);
    assertEquals(socket.sentMessages.length, sentBeforeTick);
  });

  test("a second open while the interval is armed is a no-op", () => {
    const { socket } = createKeepAlive(clock);
    socket.open();
    // Re-fire open: `_start` early-returns when the interval is already set.
    socket.dispatchEvent(new Event("open"));
    clock.advance(5_000);
    assertEquals(getLastSent(socket).method, "ping");
  });

  test("honors custom interval and timeout", () => {
    const { socket } = createKeepAlive(clock, { interval: 5_000, timeout: 1_000 });

    socket.open();
    clock.advance(5_000);
    assertEquals(getLastSent(socket).method, "ping");

    clock.advance(1_000);
    assertEquals(socket.reconnectCalls, 1);
  });
});
