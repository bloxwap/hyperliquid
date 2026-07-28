/**
 * `fastAssetCtxs` decompression throughput: the heaviest per-frame work in the SDK.
 *
 * Every frame on this channel arrives as base64 + raw DEFLATE (RFC 1951) and must be decoded,
 * inflated and JSON-parsed before the listener sees it. Nothing else in the receive path does
 * per-frame work on that scale, and until this scenario existed the whole pipeline was unmeasured —
 * a rework of the decode path could regress throughput without any gate noticing.
 *
 * Two shapes are measured because they stress different halves of the pipeline. The snapshot
 * (the first frame after subscribing, every coin present) is dominated by inflate and JSON.parse
 * throughput. The delta (later frames, only the coins that moved) is dominated by fixed per-frame
 * overhead, so it is the one that shows any per-frame machinery the decode path allocates.
 *
 * These run against {@linkcode MockWebSocket} with pre-compressed frame text, so the measurement
 * starts at the socket and no network or compression cost is billed to the scenario.
 * @module
 */

import { deflateRawSync } from "node:zlib";
import { SubscriptionClient, WebSocketTransport } from "@bloxwap/hyperliquid";
import { scenario } from "../_harness.ts";
import { installMockWebSocket, lastMockWebSocket, type MockWebSocket, restoreWebSocket } from "../_helpers.ts";

/** Coins in a full snapshot frame — approximately a live perp universe. */
const SNAPSHOT_COINS = 320;
/** Coins in a delta frame — only the assets whose price moved since the last push. */
const DELTA_COINS = 6;

/**
 * Frames per measured sample, sized per shape so both samples take comparable wall-clock: the
 * snapshot frame costs over an order of magnitude more than the delta, and too few delta frames
 * per sample leaves the measurement dominated by scheduling variance rather than decode cost.
 */
const SNAPSHOT_FRAMES = 100;
const DELTA_FRAMES = 2000;

interface DecompressContext {
  transport: WebSocketTransport;
  socket: MockWebSocket;
  /** `onComplete` is armed per sample and fired by the listener on the final frame. */
  counter: { delivered: number; onComplete: (() => void) | undefined };
  frameText: string;
}

/** Builds the wire frame the server would push: base64 of raw-DEFLATE'd JSON, wrapped in a channel envelope. */
function buildFrame(coinCount: number): string {
  const ctxs: Record<string, { markPx: string; midPx: string }> = {};
  for (let i = 0; i < coinCount; i++) {
    ctxs[`COIN${i}`] = { markPx: (1000 + i * 1.37).toFixed(4), midPx: (1000 + i * 1.36).toFixed(4) };
  }
  const compressed = Buffer.from(deflateRawSync(Buffer.from(JSON.stringify(ctxs)))).toString("base64");
  return JSON.stringify({ channel: "fastAssetCtxs", data: compressed });
}

/**
 * The listener chain is asynchronous (decompression is queued so frames stay in arrival order),
 * so a sample is only complete once every injected frame has been delivered.
 */
function makeScenario(name: string, coinCount: number, frames: number, description: string): void {
  scenario({
    name,
    group: "subscription",
    description,
    unit: "frame",
    unitsPerIteration: frames,
    iterations: 1,
    setup: async (): Promise<DecompressContext> => {
      installMockWebSocket();
      const transport = new WebSocketTransport({ url: "wss://perf.local/ws" });
      await transport.ready();
      const socket = lastMockWebSocket();

      const counter: DecompressContext["counter"] = { delivered: 0, onComplete: undefined };
      const client = new SubscriptionClient({ transport });
      await client.fastAssetCtxs(() => {
        if (++counter.delivered === frames) counter.onComplete?.();
      });

      return { transport, socket, counter, frameText: buildFrame(coinCount) };
    },
    run: async ({ socket, counter, frameText }: DecompressContext) => {
      counter.delivered = 0;
      // Settles on the last delivery. Timer-based draining would bill a macrotask hop to every
      // sample, which on the small delta frame is larger than the work being measured.
      const drained = new Promise<void>((resolve) => {
        counter.onComplete = resolve;
      });
      for (let i = 0; i < frames; i++) {
        socket.dispatchEvent(new MessageEvent("message", { data: frameText }));
      }
      await drained;
      return { deliveredPerTick: counter.delivered / frames };
    },
    teardown: ({ transport }: DecompressContext) => {
      transport.close();
      restoreWebSocket();
    },
  });
}

makeScenario(
  "fast_asset_ctxs_snapshot_decompress",
  SNAPSHOT_COINS,
  SNAPSHOT_FRAMES,
  `End-to-end fastAssetCtxs delivery of a full ${SNAPSHOT_COINS}-coin snapshot frame: base64 decode, raw inflate and JSON parse`,
);

makeScenario(
  "fast_asset_ctxs_delta_decompress",
  DELTA_COINS,
  DELTA_FRAMES,
  `End-to-end fastAssetCtxs delivery of a ${DELTA_COINS}-coin delta frame: dominated by fixed per-frame decode overhead`,
);
