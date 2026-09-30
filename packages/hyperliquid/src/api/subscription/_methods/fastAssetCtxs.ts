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
import type { ISubscription, ISubscriptionTransport, TransportError } from "../../../transport/mod.ts";
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
  let decoder = DECODERS.get(config.transport);
  if (decoder === undefined) {
    decoder = createDecoder();
    DECODERS.set(config.transport, decoder);
  }
  const recipient: Recipient = { listener, active: true };
  decoder.recipients.add(recipient);
  let failureSignal: AbortSignal | undefined;
  const retire = (): void => {
    recipient.active = false;
    decoder.recipients.delete(recipient);
    options?.signal?.removeEventListener("abort", retire);
    failureSignal?.removeEventListener("abort", retire);
  };
  options?.signal?.addEventListener("abort", retire, { once: true });
  if (options?.signal?.aborted) retire();
  try {
    // One shared listener identity gives the transport manager one event registration while
    // retaining an independent transport lease, cancellation and error callback for each caller.
    return config.transport
      .subscribe<string>(payload.type, payload, decoder.onFrame, {
        ...options,
        onError: (error: TransportError): void => {
          retire();
          options?.onError?.(error);
        },
      })
      .then(
        (subscription) => {
          failureSignal = subscription.failureSignal;
          failureSignal?.addEventListener("abort", retire, { once: true });
          if (failureSignal?.aborted) retire();
          return {
            failureSignal,
            unsubscribe: (): Promise<void> => {
              retire();
              return subscription.unsubscribe();
            },
          };
        },
        (error) => {
          retire();
          throw error;
        },
      );
  } catch (error) {
    retire();
    throw error;
  }
}

/** A local caller whose lease is independent of the shared decode queue. */
interface Recipient {
  listener: (data: FastAssetCtxsEvent) => void;
  active: boolean;
}
interface Decoder {
  recipients: Set<Recipient>;
  onFrame: (event: CustomEvent<string>) => void;
}
/** Weak transport ownership: decoders never retain unrelated or discarded transports. */
const DECODERS = new WeakMap<ISubscriptionTransport, Decoder>();
/** Logged for a nonterminal corrupt frame or throwing listener. */
const DELIVERY_FAILED = "fastAssetCtxs: failed to deliver an event, continuing with the next one:";

function createDecoder(): Decoder {
  const recipients = new Set<Recipient>();
  let queue = Promise.resolve();
  let queued = 0;
  return {
    recipients,
    onFrame: (event: CustomEvent<string>): void => {
      // Capture the recycled shell and current leases synchronously. Later subscribers must
      // not receive old queued frames, and retiring a lease suppresses its pending delivery.
      const data = event.detail;
      const targets = recipients.size === 1 ? recipients.values().next().value! : [...recipients];
      if (recipients.size === 0) return;
      if (INFLATE_RAW_SYNC !== undefined && !forceStreamDecompressForTests && queued === 0) {
        try {
          fanOut(decompressSync(data), targets);
        } catch (error) {
          console.error(DELIVERY_FAILED, error);
        }
        return;
      }
      queued++;
      queue = queue.then(async () => {
        try {
          fanOut(await decompress(data), targets);
        } catch (error) {
          console.error(DELIVERY_FAILED, error);
        } finally {
          queued--;
        }
      });
    },
  };
}

/**
 * Decode once, retaining the existing mutable callback contract: multiple callers receive
 * independent outer maps and price records. One caller uses the parsed object directly.
 */
function fanOut(data: FastAssetCtxsEvent, targets: Recipient | Recipient[]): void {
  if (!Array.isArray(targets)) {
    invoke(targets, data);
    return;
  }
  const coins = Object.keys(data);
  for (const recipient of targets) {
    if (!recipient.active) continue;
    const copy: FastAssetCtxsEvent = {};
    for (const coin of coins) {
      const prices = { ...data[coin] };
      if (coin === "__proto__")
        Object.defineProperty(copy, coin, { value: prices, enumerable: true, writable: true, configurable: true });
      else copy[coin] = prices;
    }
    invoke(recipient, copy);
  }
}
function invoke(recipient: Recipient, data: FastAssetCtxsEvent): void {
  if (!recipient.active) return;
  try {
    recipient.listener(data);
  } catch (error) {
    console.error(DELIVERY_FAILED, error);
  }
}

// --- Decompress hot path ----------------------------------------------------

/** Reused across frames so UTF-8 decode allocates no decoder state. */
const TEXT_DECODER = new TextDecoder();

/**
 * Standard base64 alphabet lookup: index is the char code, value is the 6-bit sextet (or 255 for
 * padding / invalid). Built once so decoding never walks a string table per character.
 */
const BASE64_LUT = /* @__PURE__ */ (() => {
  const table = new Uint8Array(128).fill(255);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  table["=".charCodeAt(0)] = 0; // padding contributes zero bits; length logic drops them
  return table;
})();

/**
 * Grows to the largest decoded base64 body seen and is retained between frames, so steady-state
 * base64 decode allocates nothing beyond the inflated output.
 */
let base64Scratch: Uint8Array<ArrayBuffer> = new Uint8Array(0);

/**
 * Grows to the largest inflated JSON body seen and is retained between frames, so multi-chunk
 * stream merges allocate nothing in steady state.
 */
let inflateScratch: Uint8Array<ArrayBuffer> = new Uint8Array(0);

/**
 * Decode a standard base64 string into binary.
 *
 * Prefers the platform `Buffer` when available (Node, Bun — SIMD-backed and far faster than a
 * per-character JS loop). Falls back to a table-driven decoder for environments without `Buffer`
 * (e.g. some browser / RN builds), writing into the module-level scratch buffer.
 *
 * Invalid input throws, matching `atob`: `Buffer.from(..., "base64")` is lenient and would
 * otherwise feed garbage into the inflater, which rejects asynchronously and can surface as an
 * unhandled rejection on the write side of the stream.
 */
/**
 * Bytes a well-formed standard-base64 string of this length decodes to: each 4 characters carry 3
 * bytes, and each trailing `=` drops one. `Buffer`'s decoder silently skips anything outside the
 * alphabet, so comparing its output length against this is an O(1) validity check — it catches
 * exactly the inputs a full-string alphabet scan would, without walking the string a second time.
 */
function expectedBase64Bytes(data: string): number {
  let padding = 0;
  if (data.charCodeAt(data.length - 1) === 0x3d) padding++;
  if (data.charCodeAt(data.length - 2) === 0x3d) padding++;
  return (data.length >> 2) * 3 - padding;
}

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  // Length must be a non-zero multiple of 4 (standard base64 with padding).
  if (data.length === 0 || data.length % 4 !== 0) {
    throw new Error("Invalid base64");
  }

  // `Buffer` is a global on Node and Bun; avoid a bare identifier so browser/RN type-check stays clean.
  const Buf = (globalThis as { Buffer?: { from(data: string, enc: string): Uint8Array } }).Buffer;
  if (Buf !== undefined) {
    // Reject non-alphabet input before the lenient Buffer decoder can accept it.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new Error("Invalid base64");
    }
    // Own the bytes in a fresh `Uint8Array` so the result is `ArrayBuffer`-backed (not
    // `ArrayBufferLike` / SharedArrayBuffer) and is accepted by `DecompressionStream.write`
    // without a cast. The copy is dwarfed by inflate; Buffer's base64 decode is still far faster
    // than a JS loop.
    const buf = Buf.from(data, "base64");
    const out: Uint8Array<ArrayBuffer> = new Uint8Array(buf.byteLength);
    out.set(buf);
    return out;
  }

  // Table path (no Buffer): alphabet is validated via the LUT so invalid characters throw here.
  // Length without padding: each 4 chars → 3 bytes; trailing `=` reduce the last group.
  let padding = 0;
  if (data.charCodeAt(data.length - 1) === 0x3d) padding++;
  if (data.charCodeAt(data.length - 2) === 0x3d) padding++;
  const outLen = (data.length >> 2) * 3 - padding;
  if (base64Scratch.length < outLen) base64Scratch = new Uint8Array(outLen);
  const out = base64Scratch;
  const lut = BASE64_LUT;

  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = lut[data.charCodeAt(i)!] ?? 255;
    const b = lut[data.charCodeAt(i + 1)!] ?? 255;
    const c = lut[data.charCodeAt(i + 2)!] ?? 255;
    const d = lut[data.charCodeAt(i + 3)!] ?? 255;
    // Codes outside ASCII or outside the alphabet leave 255 in the LUT (and non-ASCII
    // `charCodeAt` yields `undefined` → 255 via `??` above).
    if (a === 255 || b === 255 || c === 255 || d === 255) throw new Error("Invalid base64");
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < outLen) out[o++] = (triple >> 16) & 0xff;
    if (o < outLen) out[o++] = (triple >> 8) & 0xff;
    if (o < outLen) out[o++] = triple & 0xff;
  }
  // subarray keeps the ArrayBuffer generic parameter.
  return out.subarray(0, outLen);
}

/**
 * Resolves a native synchronous raw-inflate straight to text, when the runtime has one.
 *
 * Bun's own `Bun.inflateSync` (raw DEFLATE by default) is preferred there: it measured ~40% faster
 * than `node:zlib` on a delta frame (1.9 vs 3.5 µs, most of it fixed per-call cost) and ~20% on a
 * snapshot, with byte-identical output. It returns a plain `Uint8Array`, decoded with the shared
 * `TextDecoder`. Elsewhere, `node:zlib` is reachable through `process.getBuiltinModule` on
 * Node >= 22.3; its `inflateRawSync` returns a `Buffer`, whose `toString("utf8")` decodes the
 * ASCII-heavy JSON measurably faster than a `TextDecoder`. Either collapses the whole per-frame
 * stream pipeline — a `DecompressionStream`, a writer, a reader and four-plus promises — into one
 * native call, which also removes the cross-task window that made a frame's payload observable to a
 * later frame. Browser / RN builds have neither, so they keep the `DecompressionStream` path below.
 * Exported (never from `mod.ts`) so tests can resolve against a scope without `Bun` and reach the
 * `node:zlib` arm, which Bun itself never takes.
 *
 * @param scope The global object to probe; production always passes `globalThis`.
 */
export function resolveInflateRawSync(scope: object): ((data: Uint8Array) => string) | undefined {
  const bun = (scope as { Bun?: { inflateSync?: (data: Uint8Array) => Uint8Array } }).Bun;
  const bunInflate = bun?.inflateSync;
  if (typeof bunInflate === "function") return (data: Uint8Array): string => TEXT_DECODER.decode(bunInflate(data));

  const proc = (scope as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const zlib = proc?.getBuiltinModule?.("node:zlib") as { inflateRawSync?: (d: Uint8Array) => Uint8Array } | undefined;
  const zlibInflate = zlib?.inflateRawSync;
  if (typeof zlibInflate !== "function") return undefined;
  // The cast is structural: the declared return type stays `Uint8Array` so the browser/RN
  // type-check stays clean, but node:zlib hands back a `Buffer`.
  return (data: Uint8Array): string =>
    (zlibInflate.call(zlib, data) as Uint8Array & { toString(encoding: "utf8"): string }).toString("utf8");
}

/** The runtime's native sync inflater, resolved once at module load: the answer cannot change. */
const INFLATE_RAW_SYNC: ((data: Uint8Array) => string) | undefined = /* @__PURE__ */ resolveInflateRawSync(globalThis);

/**
 * When `true`, {@linkcode decompress} skips the native sync inflater and uses `DecompressionStream`.
 * Package-internal test hook so Bun/Node coverage still exercises the browser stream path.
 */
let forceStreamDecompressForTests = false;

/** Package-internal: force the `DecompressionStream` path for the next decompress calls. */
export function _setForceStreamDecompressForTests(force: boolean): void {
  forceStreamDecompressForTests = force;
}

/**
 * Native decode of a base64 + raw DEFLATE payload. Only valid when {@linkcode INFLATE_RAW_SYNC} is
 * available; callers check that first.
 *
 * The pooled `Buffer` feeds the inflater directly — it is fully consumed before this returns, so
 * the defensive copy `decodeBase64` makes for `DecompressionStream.write`'s typing buys nothing
 * here, and the decoded length stands in for that path's full-string alphabet scan.
 */
function decompressSync(data: string): FastAssetCtxsEvent {
  const inflateToText = INFLATE_RAW_SYNC as (data: Uint8Array) => string;
  const Buf = (globalThis as { Buffer?: { from(data: string, enc: string): Uint8Array } }).Buffer;
  if (Buf === undefined) {
    // No `Buffer` to decode through: fall back to the table decoder, but keep the sync inflater.
    return JSON.parse(inflateToText(decodeBase64(data)));
  }
  if (data.length === 0 || data.length % 4 !== 0) throw new Error("Invalid base64");
  const pooled = Buf.from(data, "base64");
  if (pooled.byteLength !== expectedBase64Bytes(data)) throw new Error("Invalid base64");
  return JSON.parse(inflateToText(pooled));
}

/** Decode a base64 + raw DEFLATE (RFC 1951) payload into a {@linkcode FastAssetCtxsEvent}. */
async function decompress(data: string): Promise<FastAssetCtxsEvent> {
  // Native path (Node / Bun): one synchronous call, no stream objects, no async hops. The pooled
  // `Buffer` feeds the inflater directly — it is fully consumed before this returns, so the
  // defensive copy `decodeBase64` makes for `DecompressionStream.write`'s typing buys nothing here,
  // and the decoded length stands in for that path's full-string alphabet scan.
  if (INFLATE_RAW_SYNC !== undefined && !forceStreamDecompressForTests) return decompressSync(data);

  const bytes = decodeBase64(data);
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  // Do not await write/close before draining: backpressure on multi-chunk output would deadlock.
  // Absorb write-side rejections so a corrupt payload that fails inflate cannot surface as an
  // unhandled rejection after the reader has already thrown into the caller's catch.
  const writeSide = writer.write(bytes).then(() => writer.close());
  writeSide.catch(() => {});

  const reader = stream.readable.getReader();
  // Fast path: the common small update fits in one stream chunk — no merge, no scratch grow.
  const first = await reader.read();
  if (first.done) return JSON.parse(TEXT_DECODER.decode(new Uint8Array(0)));
  const second = await reader.read();
  if (second.done) {
    // Single chunk: decode in place. `first.value` is owned by the stream and is not retained.
    return JSON.parse(TEXT_DECODER.decode(first.value));
  }

  // Multi-chunk: merge into the retained scratch, growing only when a frame exceeds the previous max.
  let total = first.value.length + second.value.length;
  const chunks: Uint8Array[] = [first.value, second.value];
  let result = await reader.read();
  while (!result.done) {
    chunks.push(result.value);
    total += result.value.length;
    result = await reader.read();
  }
  if (inflateScratch.length < total) inflateScratch = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    inflateScratch.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(TEXT_DECODER.decode(inflateScratch.subarray(0, total)));
}
