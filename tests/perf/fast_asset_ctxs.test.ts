/**
 * Robustness test for the `fastAssetCtxs` subscription.
 *
 * `fastAssetCtxs` events arrive as base64 + raw-DEFLATE JSON strings and are
 * decompressed sequentially through an internal promise queue. A listener
 * that throws must not permanently kill that queue: later messages must
 * still be delivered.
 *
 * - Pre-fix: the listener throw rejects the shared queue promise, so every
 *   subsequent message is dropped — this test FAILS (expected failure that
 *   demonstrates the bug).
 * - Post-fix: deliveries continue after a throw — this test passes.
 *
 * ## Reading the pre-fix failure
 *
 * Nothing handles the rejected queue promise, so the throw also surfaces as an unhandled
 * rejection. Bun's test runner fails a test on an unhandled rejection unconditionally —
 * neither `process.on("unhandledRejection")` nor the `unhandledrejection` event can opt out
 * of it — so the reported failure is `error: listener boom` and the run aborts before the
 * assertion below is reached. Both symptoms have the same single cause: the shared queue is
 * dead, and messages 3-5 never arrive. A fix that isolates listener errors per message
 * removes both at once.
 *
 * @module
 */

import { test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import { SubscriptionClient, WebSocketTransport } from "@bloxwap/hyperliquid";
import { installMockWebSocket, lastMockWebSocket, restoreWebSocket } from "./_helpers.ts";

/** Compresses a JSON payload to base64 + raw DEFLATE (RFC 1951), the wire format of `fastAssetCtxs`. */
async function compressToBase64(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));

  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let result = await reader.read();
  while (!result.done) {
    chunks.push(result.value);
    result = await reader.read();
  }

  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  let binary = "";
  for (const byte of merged) binary += String.fromCharCode(byte);
  return btoa(binary);
}

test("fastAssetCtxs: deliveries continue after a listener throws", async () => {
  installMockWebSocket();

  try {
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
    await transport.ready();
    const socket = lastMockWebSocket();
    const client = new SubscriptionClient({ transport });

    const delivered: number[] = [];
    await client.fastAssetCtxs(() => {
      const seq = delivered.length + 1;
      delivered.push(seq);
      if (seq === 2) throw new Error("listener boom");
    });

    for (let i = 1; i <= 5; i++) {
      const data = await compressToBase64({ [`COIN${i}`]: { markPx: String(i) } });
      socket.serverSend({ channel: "fastAssetCtxs", data });
    }

    // Let the sequential decompress-and-deliver queue drain.
    await new Promise((resolve) => setTimeout(resolve, 100));

    transport.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(
      delivered,
      [1, 2, 3, 4, 5],
      "messages after the throwing listener call were not delivered (delivery queue died)",
    );
  } finally {
    restoreWebSocket();
  }
});

test("fastAssetCtxs: frames stay in arrival order when sync and queued decodes interleave", async () => {
  // Where a native inflater exists, a frame is decoded synchronously and delivered in the
  // dispatch tick; the `DecompressionStream` path still goes through the promise queue. A frame
  // taking the fast path must never overtake one still queued ahead of it.
  const { _setForceStreamDecompressForTests } = await import("../../src/api/subscription/_methods/fastAssetCtxs.ts");

  installMockWebSocket();
  try {
    const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
    await transport.ready();
    const socket = lastMockWebSocket();
    const client = new SubscriptionClient({ transport });

    const delivered: number[] = [];
    await client.fastAssetCtxs((data) => {
      delivered.push(Number(Object.keys(data)[0]!.slice(4)));
    });

    // Alternate the two decode paths frame by frame.
    for (let i = 1; i <= 6; i++) {
      const data = await compressToBase64({ [`COIN${i}`]: { markPx: String(i) } });
      _setForceStreamDecompressForTests(i % 2 === 1);
      socket.serverSend({ channel: "fastAssetCtxs", data });
    }
    _setForceStreamDecompressForTests(false);

    await new Promise((resolve) => setTimeout(resolve, 100));
    transport.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(delivered, [1, 2, 3, 4, 5, 6], "a synchronously decoded frame overtook a queued one");
  } finally {
    _setForceStreamDecompressForTests(false);
    restoreWebSocket();
  }
});
