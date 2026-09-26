/**
 * Unit tests for WebSocketConnectionEvents: the four-state lifecycle derived from the socket's
 * open/close/termination signals, and the exactly-once-per-transition dispatch.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals } from "@jsr/std__assert";
import {
  WebSocketConnectionEvents,
  type WebSocketConnectionState,
} from "../../../src/transport/websocket/_connectionState.ts";
import type { ReconnectingWebSocket } from "../../../src/transport/websocket/_reconnectingSocket.ts";
import { MockWebSocket } from "./_mock.ts";

/** Creates a tracker over a mock socket, recording every dispatched state. */
function createTracker(): {
  socket: MockWebSocket;
  events: WebSocketConnectionEvents;
  states: WebSocketConnectionState[];
} {
  const socket = new MockWebSocket() as ReconnectingWebSocket & MockWebSocket;
  const events = new WebSocketConnectionEvents(socket);
  const states: WebSocketConnectionState[] = [];
  events.addEventListener("connectionstatechange", (event) => states.push(event.detail));
  return { socket, events, states };
}

describe("WebSocketConnectionEvents", () => {
  test("starts in connecting and transitions to connected on open", () => {
    const { socket, events, states } = createTracker();
    assertEquals(events.state, "connecting");

    socket.open();

    assertEquals(events.state, "connected");
    assertEquals(states, ["connected"]);
  });

  test("a close after open transitions to reconnecting, the next open back to connected", () => {
    const { socket, events, states } = createTracker();
    socket.open();
    socket.disconnect();

    assertEquals(events.state, "reconnecting");

    socket.open();

    assertEquals(events.state, "connected");
    assertEquals(states, ["connected", "reconnecting", "connected"]);
  });

  test("a close before the first open keeps the connecting state and dispatches nothing", () => {
    const { socket, events, states } = createTracker();
    socket.disconnect();

    assertEquals(events.state, "connecting");
    assertEquals(states, []);
  });

  test("termination transitions to disconnected, exactly once", () => {
    const { socket, events, states } = createTracker();
    socket.open();
    socket.terminate();

    assertEquals(events.state, "disconnected");
    assertEquals(states, ["connected", "disconnected"]);
  });

  test("termination before any open transitions straight to disconnected", () => {
    const { socket, events, states } = createTracker();
    socket.terminate();

    assertEquals(events.state, "disconnected");
    assertEquals(states, ["disconnected"]);
  });

  test("repeated closes while reconnecting do not re-dispatch", () => {
    const { socket, states } = createTracker();
    socket.open();
    socket.disconnect();
    socket.disconnect(); // another failed attempt: already reconnecting

    assertEquals(states, ["connected", "reconnecting"]);
  });

  test("removeEventListener detaches a listener", () => {
    const { socket, events } = createTracker();
    const seen: WebSocketConnectionState[] = [];
    const listener = (event: CustomEvent<WebSocketConnectionState>): void => {
      seen.push(event.detail);
    };
    events.addEventListener("connectionstatechange", listener);
    socket.open();
    events.removeEventListener("connectionstatechange", listener);
    socket.disconnect();

    assertEquals(seen, ["connected"]);
    assert(events.state === "reconnecting");
  });
});
