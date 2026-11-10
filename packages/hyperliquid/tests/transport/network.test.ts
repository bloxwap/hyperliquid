/**
 * `isTestnet` must agree with a known Hyperliquid host. Custom hosts are not inspected.
 * Offline: HTTP never connects, and the WebSocket tests inject a socket that does not dial.
 * @module
 */

import { describe, test } from "bun:test";
import { assert, assertEquals, assertThrows } from "@jsr/std__assert";
import {
  HttpTransport,
  MAINNET_API_URL,
  MAINNET_API_WS_URL,
  MAINNET_RPC_URL,
  TESTNET_API_URL,
  TESTNET_API_WS_URL,
  TESTNET_RPC_URL,
  WebSocketTransport,
  type WebSocketTransportOptions,
} from "@bloxwap/hyperliquid";
import { sharedWebSocketQuota } from "../../src/transport/websocket/_quota.ts";

/** A socket that never dials. `close()` fires `close` so the shared quota releases its slot. */
class StubSocket extends EventTarget {
  binaryType: "blob" | "arraybuffer" = "blob";
  close(): void {
    this.dispatchEvent(new Event("close"));
  }
  send(): void {}
}

/** Opens a transport against the stub socket and closes it when the test ends. */
function openWebSocket(options: WebSocketTransportOptions): WebSocketTransport {
  return new WebSocketTransport({
    ...options,
    reconnect: { maxRetries: 0, connectionTimeout: null, ...options.reconnect },
    webSocketFactory: () => new StubSocket() as unknown as WebSocket,
  });
}

describe("HttpTransport network", () => {
  test("derives testnet from a known apiUrl and defaults rpcUrl to match", () => {
    const transport = new HttpTransport({ apiUrl: TESTNET_API_URL });
    assertEquals(transport.isTestnet, true);
    assertEquals(transport.apiUrl, TESTNET_API_URL);
    assertEquals(transport.rpcUrl, TESTNET_RPC_URL);
  });

  test("derives testnet from a URL object, a trailing slash, and any case", () => {
    const transport = new HttpTransport({ apiUrl: new URL(`${TESTNET_API_URL}/`) });
    assertEquals(transport.isTestnet, true);
    assertEquals(transport.rpcUrl, TESTNET_RPC_URL);

    const shouted = new HttpTransport({ apiUrl: "HTTPS://API.HYPERLIQUID-TESTNET.XYZ/info" });
    assertEquals(shouted.isTestnet, true);
  });

  test("derives testnet from rpcUrl alone and defaults apiUrl to match", () => {
    const transport = new HttpTransport({ rpcUrl: TESTNET_RPC_URL });
    assertEquals(transport.isTestnet, true);
    assertEquals(transport.apiUrl, TESTNET_API_URL);
    assertEquals(transport.rpcUrl, TESTNET_RPC_URL);
  });

  test("rejects an explicit flag that disagrees with a known host, in either direction", () => {
    assertThrows(
      () => new HttpTransport({ apiUrl: TESTNET_API_URL, isTestnet: false }),
      TypeError,
      "isTestnet is false",
    );
    assertThrows(() => new HttpTransport({ apiUrl: MAINNET_API_URL, isTestnet: true }), TypeError, "isTestnet is true");
    assertThrows(() => new HttpTransport({ rpcUrl: MAINNET_RPC_URL, isTestnet: true }), TypeError, "rpcUrl");
    assertThrows(
      () => new HttpTransport({ apiUrl: TESTNET_API_URL, rpcUrl: MAINNET_RPC_URL }),
      TypeError,
      "apiUrl is Hyperliquid testnet but rpcUrl is Hyperliquid mainnet",
    );
  });

  test("accepts an explicit flag that matches, including a trailing-dot host", () => {
    const transport = new HttpTransport({ apiUrl: `${TESTNET_API_URL}.`, isTestnet: true });
    assertEquals(transport.isTestnet, true);
    assertEquals(transport.rpcUrl, TESTNET_RPC_URL);
  });

  test("leaves custom hosts alone, whichever flag they carry", () => {
    const mainnet = new HttpTransport({
      apiUrl: "https://api.hyperliquid.xyz.evil.test/hl",
      rpcUrl: "https://proxy.example",
    });
    assertEquals(mainnet.isTestnet, false);
    assertEquals(mainnet.rpcUrl, "https://proxy.example");

    const testnet = new HttpTransport({ apiUrl: "https://proxy.example/hl", isTestnet: true });
    assertEquals(testnet.isTestnet, true);
    assertEquals(testnet.rpcUrl, TESTNET_RPC_URL);

    const unparsable = new HttpTransport({ apiUrl: "not a url" });
    assertEquals(unparsable.isTestnet, false);
  });

  test("rejects a non-boolean flag", () => {
    assertThrows(
      () => new HttpTransport({ isTestnet: "yes" as unknown as boolean }),
      TypeError,
      "isTestnet must be a boolean",
    );
  });
});

describe("WebSocketTransport network", () => {
  test("derives testnet from a known url and charges the testnet quota", () => {
    const transport = openWebSocket({ url: TESTNET_API_WS_URL });
    try {
      assertEquals(transport.isTestnet, true);
      assertEquals(transport.socket.url, TESTNET_API_WS_URL);
      assert(transport.quota === sharedWebSocketQuota(true));
    } finally {
      transport.close();
    }
  });

  test("derives mainnet from a shouted host and a non-default path", () => {
    const transport = openWebSocket({ url: "wss://API.HYPERLIQUID.XYZ/custom" });
    try {
      assertEquals(transport.isTestnet, false);
      assert(transport.quota === sharedWebSocketQuota(false));
    } finally {
      transport.close();
    }
  });

  test("rejects an explicit flag that disagrees with a known url, in either direction", () => {
    assertThrows(
      () => new WebSocketTransport({ url: TESTNET_API_WS_URL, isTestnet: false }),
      TypeError,
      "isTestnet is false",
    );
    assertThrows(
      () => new WebSocketTransport({ url: MAINNET_API_WS_URL, isTestnet: true }),
      TypeError,
      "isTestnet is true",
    );
    assertThrows(
      () => new WebSocketTransport({ url: "wss://rpc.hyperliquid-testnet.xyz/ws", isTestnet: false }),
      TypeError,
      "url",
    );
  });

  test("allows a custom host with either flag and does not retarget the quota from the url", () => {
    const testnet = openWebSocket({ url: "ws://127.0.0.1:9", isTestnet: true });
    const mainnet = openWebSocket({ url: "wss://api.hyperliquid.xyz.evil.test/ws" });
    try {
      assertEquals(testnet.isTestnet, true);
      assert(testnet.quota === sharedWebSocketQuota(true));
      assertEquals(mainnet.isTestnet, false);
      assert(mainnet.quota === sharedWebSocketQuota(false));
    } finally {
      testnet.close();
      mainnet.close();
    }
  });
});
