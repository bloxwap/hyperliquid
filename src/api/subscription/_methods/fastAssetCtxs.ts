import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Subscription to mark and mid price events for all assets.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
 */
export const FastAssetCtxsRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of subscription. */
    type: v.literal("fastAssetCtxs"),
  });
})();
export type FastAssetCtxsRequest = v.InferOutput<typeof FastAssetCtxsRequest>;

/**
 * Event of mark and mid prices, keyed by coin.
 *
 * The first message after subscribing is a full snapshot; later messages contain only the changed coins.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
 */
export type FastAssetCtxsEvent = {
  /** Mark and mid prices for a single asset. */
  [coin: string]: {
    /**
     * Mark price.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    markPx?: string;
    /**
     * Mid price.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    midPx?: string | null;
  };
};

// ============================================================
// Execution Logic
// ============================================================

import { parse } from "../../../_base.ts";
import type { ISubscription } from "../../../transport/mod.ts";
import type { SubscriptionConfig, SubscriptionOptions } from "./_base/mod.ts";

/**
 * Subscribe to mark and mid prices for all assets.
 *
 * @param config General configuration for Subscription API subscriptions.
 * @param listener A callback function to be called when the event is received.
 * @param options Options to control the subscription lifecycle.
 * @return A request-promise that resolves with a {@link ISubscription} object to manage the subscription lifecycle.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { WebSocketTransport } from "@bloxwap/hyperliquid";
 * import { fastAssetCtxs } from "@bloxwap/hyperliquid/api/subscription";
 *
 * const transport = new WebSocketTransport();
 *
 * const sub = await fastAssetCtxs(
 *   { transport },
 *   (data) => console.log(data),
 * );
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
 */
export function fastAssetCtxs(
  config: SubscriptionConfig,
  listener: (data: FastAssetCtxsEvent) => void,
  options?: SubscriptionOptions,
): Promise<ISubscription> {
  const payload = parse(FastAssetCtxsRequest, { type: "fastAssetCtxs" });
  // The server pushes each update as a base64 + raw DEFLATE (RFC 1951) compressed JSON string (assumed to be valid).
  // Decompress sequentially so events reach the listener in arrival order.
  let queue = Promise.resolve();
  return config.transport.subscribe<string>(
    payload.type,
    payload,
    (e) => {
      // `deliver` never rejects, so a failing event cannot poison the chain. Chaining a rejected
      // promise would skip every subsequent `.then` callback, silently dropping all later updates
      // for the life of the subscription.
      queue = queue.then(() => deliver(e.detail, listener));
    },
    options,
  );
}

/**
 * Decompresses one frame and hands it to the listener, absorbing any failure.
 *
 * A decompression failure or a throwing listener affects only its own event: the returned promise
 * always fulfills, keeping the sequential queue alive for later updates.
 *
 * The error is reported to the console rather than through `options.onError`, because that callback
 * is terminal by contract — it fires at most once and means the subscription has ended — whereas one
 * bad frame or one throwing listener callback does not end the stream.
 */
async function deliver(data: string, listener: (data: FastAssetCtxsEvent) => void): Promise<void> {
  try {
    listener(await decompress(data));
  } catch (error) {
    console.error("fastAssetCtxs: failed to deliver an event, continuing with the next one:", error);
  }
}

/** Decode a base64 + raw DEFLATE (RFC 1951) payload into a {@linkcode FastAssetCtxsEvent}. */
async function decompress(data: string): Promise<FastAssetCtxsEvent> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  // Do not await write/close before draining: backpressure on multi-chunk output would deadlock.
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
  return JSON.parse(new TextDecoder().decode(merged));
}
