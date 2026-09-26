import type { ExplorerBlockEvent } from "@bloxwap/hyperliquid/api/explorer";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { collectEventsOverTime, runSubscriptionTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/explorer/_methods/explorerBlock.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "ExplorerBlockEvent");

runSubscriptionTest({
  name: "explorerBlock",
  fn: async (_t, client) => {
    const data = await collectEventsOverTime<ExplorerBlockEvent>(async (cb) => {
      await client.explorerBlock(cb);
    }, 10_000);

    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: channel, payload, and listener wiring against a mock subscription transport
// ============================================================

import { describe, test } from "bun:test";
import { assertEquals, assertRejects, assertStrictEquals } from "@jsr/std__assert";
import { TransportError } from "@bloxwap/hyperliquid";
import { explorerBlock } from "@bloxwap/hyperliquid/api/explorer";
import { MockExplorerSubscriptionTransport } from "./_mockTransport.ts";

describe("explorerBlock (offline)", () => {
  test("subscribes to the duck channel with the validated payload", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    const onError = () => {};

    const sub = await explorerBlock({ transport }, () => {}, onError);

    assertEquals(transport.calls.length, 1);
    assertEquals(transport.calls[0].channel, "explorerBlock_");
    assertEquals(transport.calls[0].payload, { type: "explorerBlock" });
    assertStrictEquals(transport.calls[0].options?.onError, onError);
    assertEquals(typeof sub.unsubscribe, "function");
  });

  test("forwards event detail to the listener", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    const received: ExplorerBlockEvent[] = [];

    await explorerBlock({ transport }, (data) => received.push(data));

    const detail: ExplorerBlockEvent = [{ blockTime: 1, hash: "0xabc", height: 1, numTxs: 0, proposer: "0xdef" }];
    transport.dispatch("explorerBlock_", detail);

    assertEquals(received, [detail]);
  });

  test("the returned subscription unsubscribes", async () => {
    const transport = new MockExplorerSubscriptionTransport();

    const sub = await explorerBlock({ transport }, () => {});
    await sub.unsubscribe();

    assertEquals(transport.unsubscribeCount, 1);
  });

  test("subscribe failures reject the promise", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    transport.error = new TransportError("connection lost");

    await assertRejects(() => explorerBlock({ transport }, () => {}), TransportError, "connection lost");
  });
});
