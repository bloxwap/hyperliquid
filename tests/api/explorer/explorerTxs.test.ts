import type { ExplorerTxsEvent } from "@bloxwap/hyperliquid/api/explorer";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { collectEventsOverTime, runSubscriptionTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/explorer/_methods/explorerTxs.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "ExplorerTxsEvent");

runSubscriptionTest({
  name: "explorerTxs",
  fn: async (_t, client) => {
    const data = await collectEventsOverTime<ExplorerTxsEvent>(async (cb) => {
      await client.explorerTxs(cb);
    }, 10_000);

    schemaCoverage(responseSchema, data, ["#/items/properties/error/defined"]);
  },
});

// ============================================================
// Offline: channel, payload, and listener wiring against a mock subscription transport
// ============================================================

import { describe, test } from "bun:test";
import { assertEquals, assertRejects, assertStrictEquals } from "@jsr/std__assert";
import { TransportError } from "@bloxwap/hyperliquid";
import { explorerTxs } from "@bloxwap/hyperliquid/api/explorer";
import { MockExplorerSubscriptionTransport } from "./_mockTransport.ts";

describe("explorerTxs (offline)", () => {
  test("subscribes to the duck channel with the validated payload", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    const onError = () => {};

    const sub = await explorerTxs({ transport }, () => {}, onError);

    assertEquals(transport.calls.length, 1);
    assertEquals(transport.calls[0].channel, "explorerTxs_");
    assertEquals(transport.calls[0].payload, { type: "explorerTxs" });
    assertStrictEquals(transport.calls[0].options?.onError, onError);
    assertEquals(typeof sub.unsubscribe, "function");
  });

  test("forwards event detail to the listener", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    const received: ExplorerTxsEvent[] = [];

    await explorerTxs({ transport }, (data) => received.push(data));

    const detail: ExplorerTxsEvent = [
      { action: { type: "order" }, block: 1, error: null, hash: "0xabc", time: 1, user: "0xdef" },
    ];
    transport.dispatch("explorerTxs_", detail);

    assertEquals(received, [detail]);
  });

  test("the returned subscription unsubscribes", async () => {
    const transport = new MockExplorerSubscriptionTransport();

    const sub = await explorerTxs({ transport }, () => {});
    await sub.unsubscribe();

    assertEquals(transport.unsubscribeCount, 1);
  });

  test("subscribe failures reject the promise", async () => {
    const transport = new MockExplorerSubscriptionTransport();
    transport.error = new TransportError("connection lost");

    await assertRejects(() => explorerTxs({ transport }, () => {}), TransportError, "connection lost");
  });
});
