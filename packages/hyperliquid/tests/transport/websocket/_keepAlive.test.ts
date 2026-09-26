/**
 * Tests for the WebSocket keep-alive watchdog: the ping cadence, the pong
 * deadline, and the watchdog teardown on disconnect.
 * @module
 */

import { afterEach, beforeEach, describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import { FakeTime } from "@jsr/std__testing/time";
import type { ReconnectingWebSocket } from "../../../src/transport/websocket/_reconnectingSocket.ts";
import { WebSocketKeepAlive, type WebSocketKeepAliveOptions } from "../../../src/transport/websocket/_keepAlive.ts";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";
import { getLastSent, MockWebSocket } from "./_mock.ts";

/** Creates a keep-alive watchdog over a mock socket. */
function createKeepAlive(options?: WebSocketKeepAliveOptions): { socket: MockWebSocket } {
  const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
  const hlEvents = new HyperliquidEventTarget(socket);
  new WebSocketKeepAlive(socket, hlEvents, options);
  return { socket };
}

describe("WebSocketKeepAlive", () => {
  // The npm build of `@std/testing/time` drops the `[Symbol.dispose]` member the Deno version
  // declares, so the clock is installed and restored through hooks instead of a `using` binding.
  let time: FakeTime;

  beforeEach(() => {
    time = new FakeTime();
  });

  afterEach(() => {
    time.restore();
  });

  test("reconnects when a ping stays unanswered", () => {
    const { socket } = createKeepAlive();

    socket.open();
    time.tick(5_000);
    assertEquals(getLastSent(socket).method, "ping");

    time.tick(3_000);
    assertEquals(socket.reconnectCalls, 1);
  });

  test("a pong in time keeps the connection", () => {
    const { socket } = createKeepAlive();

    socket.open();
    time.tick(5_000);
    socket.mockMessage({ channel: "pong" });

    time.tick(3_000);
    assertEquals(socket.reconnectCalls, 0);
  });

  test("disconnect clears the watchdog", () => {
    const { socket } = createKeepAlive();

    socket.open();
    time.tick(5_000);
    socket.disconnect();

    const sentBeforeTick = socket.sentMessages.length;
    time.tick(60_000);
    assertEquals(socket.reconnectCalls, 0);
    assertEquals(socket.sentMessages.length, sentBeforeTick);
  });

  test("a socket error also clears the watchdog", () => {
    const { socket } = createKeepAlive();

    socket.open();
    time.tick(5_000);
    // The error listener is a distinct arrow from the close handler — both call `_stop`.
    socket.dispatchEvent(new Event("error"));

    const sentBeforeTick = socket.sentMessages.length;
    time.tick(60_000);
    assertEquals(socket.reconnectCalls, 0);
    assertEquals(socket.sentMessages.length, sentBeforeTick);
  });

  test("a second open while the interval is armed is a no-op", () => {
    const { socket } = createKeepAlive();
    socket.open();
    // Re-fire open: `_start` early-returns when the interval is already set.
    socket.dispatchEvent(new Event("open"));
    time.tick(5_000);
    assertEquals(getLastSent(socket).method, "ping");
  });

  test("honors custom interval and timeout", () => {
    const { socket } = createKeepAlive({ interval: 5_000, timeout: 1_000 });

    socket.open();
    time.tick(5_000);
    assertEquals(getLastSent(socket).method, "ping");

    time.tick(1_000);
    assertEquals(socket.reconnectCalls, 1);
  });
});
