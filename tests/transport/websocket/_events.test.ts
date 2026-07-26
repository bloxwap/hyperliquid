/**
 * Tests for the typed event target: routing of Hyperliquid envelopes and
 * explorer pushes, and tolerance to malformed frames.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@jsr/std__assert";
import { HyperliquidEventTarget } from "../../../src/transport/websocket/_events.ts";

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
  });
});
