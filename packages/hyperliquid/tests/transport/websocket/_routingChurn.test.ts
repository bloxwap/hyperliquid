import { expect, test } from "bun:test";
import { WebSocketTransport, WebSocketQuota, SubscriptionClient } from "@bloxwap/hyperliquid";
import {
  frameEventType,
  frameFallbackEventType,
  payloadEventType,
  _routedTypeCacheSizeForTests,
} from "../../../src/transport/websocket/_routing.ts";
import { installMockWebSocket, lastMockWebSocket, restoreWebSocket } from "../../perf/_helpers.ts";
const channels = ["userFills", "userFundings", "userHistoricalOrders"];
const user = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
function churn(): void {
  for (const channel of channels) {
    for (let i = 0; i < 20000; i++) frameEventType(channel, { user: `0x${i.toString(16).padStart(40, "0")}` });
    expect(_routedTypeCacheSizeForTests(channel)).toBe(1024);
  }
}
test("historical and unregistered routes stay bounded across multiple channels", () => {
  const routes = channels.map((channel) => frameEventType(channel, { user })!);
  churn();
  for (let i = 0; i < channels.length; i++) {
    const uppercase = `0x${user.slice(2).toUpperCase()}`;
    expect(frameEventType(channels[i], { user: uppercase })).toBe(routes[i]);
    expect(payloadEventType(channels[i], { user })).toBe(routes[i]);
    for (let repeat = 0; repeat < 10000; repeat++) frameEventType(channels[i], { user });
    expect(_routedTypeCacheSizeForTests(channels[i])).toBe(1024);
  }
});
test("evicting interned keys preserves active listener routes on separate transports", async () => {
  installMockWebSocket();
  const transports: WebSocketTransport[] = [];
  try {
    const sockets = [];
    let delivered = 0;
    for (let i = 0; i < 2; i++) {
      const transport = new WebSocketTransport({ url: "wss://test.local/ws", quota: new WebSocketQuota() });
      transports.push(transport);
      await transport.ready();
      sockets.push(lastMockWebSocket());
      await new SubscriptionClient({ transport }).userFills({ user }, () => {
        delivered++;
      });
    }
    churn();
    for (const socket of sockets)
      socket.serverSend({ channel: "userFills", data: { user, isSnapshot: false, fills: [] } });
    expect(delivered).toBe(2);
    for (const transport of transports) transport.close();
    churn();
    for (const channel of channels) expect(_routedTypeCacheSizeForTests(channel)).toBe(1024);
  } finally {
    for (const transport of transports) transport.close();
    restoreWebSocket();
  }
});

test("compound and primary fallback route retention stays bounded under secondary-key churn", () => {
  const compound = payloadEventType("candle", { coin: "BTC", interval: "1m" });
  const primary = payloadEventType("candle", { coin: "BTC" });
  for (let i = 0; i < 20000; i++) {
    const data = { s: `COIN${i}`, i: "1m" };
    frameEventType("candle", data);
    frameFallbackEventType("candle", data);
  }
  expect(_routedTypeCacheSizeForTests("candle")).toBe(1024);
  expect(frameEventType("candle", { s: "BTC", i: "1m" })).toBe(compound);
  expect(frameFallbackEventType("candle", { s: "BTC", i: "1m" })).toBe(primary);
  expect(_routedTypeCacheSizeForTests("candle")).toBe(1024);
});
