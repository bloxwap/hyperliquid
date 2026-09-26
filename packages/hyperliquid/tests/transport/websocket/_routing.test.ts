/**
 * Tests for the subscription route keys: both sides of the wire must agree, and everything the
 * table does not know must stay broadcast.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@jsr/std__assert";
import { frameEventType, isBareChannel, payloadEventType } from "../../../src/transport/websocket/_routing.ts";

describe("payloadEventType / frameEventType agreement", () => {
  test("l2Book keys on the coin from both sides", () => {
    assertEquals(
      payloadEventType("l2Book", { type: "l2Book", coin: "BTC" }),
      frameEventType("l2Book", { coin: "BTC" }),
    );
  });

  test("distinct coins get distinct types", () => {
    assert(
      payloadEventType("l2Book", { type: "l2Book", coin: "BTC" }) !==
        payloadEventType("l2Book", { type: "l2Book", coin: "ETH" }),
    );
  });

  test("trades reads the coin out of the frame's first element", () => {
    assertEquals(
      payloadEventType("trades", { type: "trades", coin: "ETH" }),
      frameEventType("trades", [
        { coin: "ETH", px: "1" },
        { coin: "ETH", px: "2" },
      ]),
    );
  });

  test("candle reads the coin from `s`, ignoring the interval", () => {
    assertEquals(
      payloadEventType("candle", { type: "candle", coin: "ETH", interval: "1m" }),
      frameEventType("candle", { s: "ETH", i: "1m" }),
    );
    // The interval is left to the method's own filter, so both intervals share one route.
    assertEquals(
      payloadEventType("candle", { type: "candle", coin: "ETH", interval: "1h" }),
      payloadEventType("candle", { type: "candle", coin: "ETH", interval: "1m" }),
    );
  });

  test("user channels key on the address, case-insensitively", () => {
    assertEquals(
      payloadEventType("userFills", { type: "userFills", user: "0xAB00" }),
      frameEventType("userFills", { user: "0xab00", fills: [] }),
    );
  });

  test("webData3 reads the address out of the nested userState", () => {
    assertEquals(
      payloadEventType("webData3", { type: "webData3", user: "0xab00" }),
      frameEventType("webData3", { userState: { user: "0xab00" } }),
    );
  });

  test("a coin route does not match another channel's key", () => {
    assert(
      payloadEventType("l2Book", { type: "l2Book", coin: "BTC" }) !==
        payloadEventType("bbo", { type: "bbo", coin: "BTC" }),
    );
  });
});

describe("broadcast fallback", () => {
  test("an unrouted channel keys neither side", () => {
    assertEquals(payloadEventType("allMids", { type: "allMids" }), "allMids");
    assertEquals(frameEventType("allMids", { mids: {} }), undefined);
  });

  test("an unknown channel is left alone", () => {
    assertEquals(payloadEventType("somethingNew", { type: "somethingNew", coin: "BTC" }), "somethingNew");
    assertEquals(frameEventType("somethingNew", { coin: "BTC" }), undefined);
  });

  test("a routed channel whose payload lacks the key falls back to the channel", () => {
    assertEquals(payloadEventType("l2Book", { type: "l2Book" }), "l2Book");
  });

  test("a routed channel whose frame lacks the key falls back to a broadcast", () => {
    assertEquals(frameEventType("l2Book", { levels: [] }), undefined);
    assertEquals(frameEventType("l2Book", null), undefined);
    assertEquals(frameEventType("trades", []), undefined);
    assertEquals(frameEventType("userFills", { user: 42 }), undefined);
  });
});

describe("isBareChannel", () => {
  test("separates channel names from routed types", () => {
    assert(isBareChannel("l2Book"));
    assert(isBareChannel(payloadEventType("allMids", { type: "allMids" })));
    assertFalse(isBareChannel(payloadEventType("l2Book", { type: "l2Book", coin: "BTC" })));
  });
});

describe("activeAssetCtx and activeSpotAssetCtx are one subscription by design", () => {
  // This pair blocked the routing change during review, on the theory that routing could deliver
  // perp context to a spot subscriber. It cannot, and this pins down why.
  //
  // Both API methods declare `type: v.literal("activeAssetCtx")`, and both call
  // `transport.subscribe(payload.type, payload, ...)` -- so the channel is "activeAssetCtx" for
  // both, the wire request is byte-identical, and both filter on `e.detail.coin === payload.coin`.
  // They are indistinguishable to the server by design; the only real difference between them is
  // the TypeScript type of the event handed back. A given coin therefore resolves to ONE
  // subscription carrying both listeners, exactly as it did before routing existed, so routing by
  // coin is behaviour-preserving here.
  test("both methods' payloads route to the same event type", () => {
    const perpPayload = { type: "activeAssetCtx", coin: "@1" };
    const spotPayload = { type: "activeAssetCtx", coin: "@1" };

    const perpType = payloadEventType("activeAssetCtx", perpPayload);
    assertEquals(perpType, payloadEventType("activeAssetCtx", spotPayload));

    // The incoming frame resolves to that same type, so both listeners are reached.
    assertEquals(frameEventType("activeAssetCtx", { coin: "@1", ctx: { markPx: "1" } }), perpType);
  });

  test("a different coin routes elsewhere, which is the fan-out being removed", () => {
    const subscribed = payloadEventType("activeAssetCtx", { type: "activeAssetCtx", coin: "@1" });
    assert(
      subscribed !== frameEventType("activeAssetCtx", { coin: "@2", ctx: { markPx: "2" } }),
      "a frame for another coin must not reach this subscription",
    );
  });
});
