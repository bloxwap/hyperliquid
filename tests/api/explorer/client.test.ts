/**
 * Offline tests for the {@linkcode ExplorerClient} wrapper: every method must delegate to its
 * standalone function counterpart with the client's stored config.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals, assertRejects, assertStrictEquals } from "@jsr/std__assert";
import { ExplorerClient, ValidationError } from "@bloxwap/hyperliquid";
import type { ExplorerBlockEvent, ExplorerTxsEvent } from "@bloxwap/hyperliquid/api/explorer";
import { MockExplorerSubscriptionTransport, MockExplorerTransport } from "./_mockTransport.ts";

const HASH = "0x4de9f1f5d912c23d8fbb0411f01bfe0000eb9f3ccb3fec747cb96e75e8944b06";
const USER = "0x9150749c4cec13dc7c1555d0d664f08d4d81be83";

describe("ExplorerClient (offline)", () => {
  test("stores the constructor config", () => {
    const transport = new MockExplorerTransport();
    const client = new ExplorerClient({ transport });

    assertStrictEquals(client.config_.transport, transport);
  });

  test("blockDetails delegates to the explorer endpoint", async () => {
    const response = { type: "blockDetails", blockDetails: { height: 123 } };
    const transport = new MockExplorerTransport(() => response);
    const client = new ExplorerClient({ transport });
    const controller = new AbortController();

    const result = await client.blockDetails({ height: 123 }, controller.signal);

    assertEquals(transport.calls[0].endpoint, "explorer");
    assertEquals(transport.calls[0].payload, { type: "blockDetails", height: 123 });
    assertStrictEquals(transport.calls[0].signal, controller.signal);
    assertStrictEquals(result, response);
  });

  test("txDetails delegates to the explorer endpoint", async () => {
    const response = { type: "txDetails", tx: { hash: HASH } };
    const transport = new MockExplorerTransport(() => response);
    const client = new ExplorerClient({ transport });

    const result = await client.txDetails({ hash: HASH });

    assertEquals(transport.calls[0].payload, { type: "txDetails", hash: HASH });
    assertStrictEquals(result, response);
  });

  test("userDetails delegates to the explorer endpoint", async () => {
    const response = { type: "userDetails", txs: [] };
    const transport = new MockExplorerTransport(() => response);
    const client = new ExplorerClient({ transport });

    const result = await client.userDetails({ user: USER });

    assertEquals(transport.calls[0].payload, { type: "userDetails", user: USER });
    assertStrictEquals(result, response);
  });

  test("invalid params reject before any request is sent", async () => {
    const transport = new MockExplorerTransport();
    const client = new ExplorerClient({ transport });

    await assertRejects(() => client.blockDetails({ height: -1 }), ValidationError);

    assertEquals(transport.calls.length, 0);
  });

  test("explorerBlock wires the listener to the duck channel", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    const client = new ExplorerClient({ transport });
    const received: ExplorerBlockEvent[] = [];
    const onError = () => {};

    await client.explorerBlock((data) => received.push(data), onError);

    assertEquals(transport.calls[0].channel, "explorerBlock_");
    assertEquals(transport.calls[0].payload, { type: "explorerBlock" });
    assertStrictEquals(transport.calls[0].options?.onError, onError);

    transport.dispatch("explorerBlock_", []);
    assertEquals(received, [[]]);
  });

  test("explorerTxs wires the listener to the duck channel", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    const client = new ExplorerClient({ transport });
    const received: ExplorerTxsEvent[] = [];

    const sub = await client.explorerTxs((data) => received.push(data));

    assertEquals(transport.calls[0].channel, "explorerTxs_");
    assertEquals(transport.calls[0].payload, { type: "explorerTxs" });

    const detail: ExplorerTxsEvent = [
      { action: { type: "order" }, block: 1, error: null, hash: "0xabc", time: 1, user: "0xdef" },
    ];
    transport.dispatch("explorerTxs_", detail);
    assertEquals(received, [detail]);

    await sub.unsubscribe();
    assertEquals(transport.unsubscribeCount, 1);
  });
});
