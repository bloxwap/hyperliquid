/**
 * Shared mocks for the performance suite:
 * - {@linkcode MockExchangeTransport}: in-memory `IRequestTransport` with latency and concurrency instrumentation.
 * - {@linkcode MockInfoTransport}: in-memory `IRequestTransport` serving fixed Info responses.
 * - {@linkcode MockWebSocket}: a fake global `WebSocket` so `WebSocketTransport` runs fully offline.
 *
 * Everything here depends only on the public API surface (`@bloxwap/hyperliquid`),
 * so the suite runs unchanged against both the pre-fix and post-fix source trees.
 * @module
 */

import type { IRequestTransport } from "@bloxwap/hyperliquid";

/** Well-known test private key (the same one used by `tests/signing/mod.test.ts`). */
export const TEST_PRIVATE_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";

/** Successful `order` response, shaped like the real Exchange endpoint payload. */
export const ORDER_SUCCESS = {
  status: "ok",
  response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } },
} as const;

/**
 * In-memory `IRequestTransport` that records every call, tracks the in-flight
 * concurrency high-water mark, and resolves after a fixed delay with a
 * successful order response.
 */
export class MockExchangeTransport implements IRequestTransport {
  readonly isTestnet = true;
  readonly calls: { endpoint: "info" | "exchange"; payload: unknown }[] = [];
  /** Requests currently awaiting resolution. */
  inFlight = 0;
  /** Peak value of {@linkcode inFlight} — 1 means the client fully serialized requests. */
  maxInFlight = 0;
  delayMs: number;

  constructor(delayMs?: number) {
    this.delayMs = delayMs ?? 0;
  }

  request<T>(endpoint: "info" | "exchange", payload: unknown, _signal?: AbortSignal): Promise<T> {
    this.calls.push({ endpoint, payload });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const settle = (): T => {
      this.inFlight--;
      return ORDER_SUCCESS as unknown as T;
    };
    return this.delayMs > 0
      ? new Promise<T>((resolve) => setTimeout(() => resolve(settle()), this.delayMs))
      : Promise.resolve(settle());
  }
}

/**
 * In-memory `IRequestTransport` that answers Info requests from a fixed table keyed by
 * request `type`.
 *
 * Responses are stored pre-serialized and `JSON.parse`d per call, exactly as `HttpTransport`
 * does with a real response body. Without that step the scenarios would hand the client a
 * shared object graph and measure nothing but function-call overhead, and payload size —
 * the thing that actually varies in production — would not register at all.
 */
export class MockInfoTransport implements IRequestTransport {
  readonly isTestnet = false;
  /** Requests served, by request `type`. */
  readonly served = new Map<string, number>();
  private readonly _bodies = new Map<string, string>();

  /** @param payloads Response payload per request `type`, e.g. `{ l2Book: {...} }`. */
  constructor(payloads: Record<string, unknown>) {
    for (const [type, payload] of Object.entries(payloads)) {
      this._bodies.set(type, JSON.stringify(payload));
    }
  }

  request<T>(_endpoint: "info" | "exchange", payload: unknown, _signal?: AbortSignal): Promise<T> {
    const type = (payload as { type?: string } | null)?.type;
    const body = type === undefined ? undefined : this._bodies.get(type);
    if (body === undefined) {
      // Loud failure: a silent `undefined` here would show up as an implausibly fast scenario.
      return Promise.reject(new Error(`MockInfoTransport has no payload for request type ${JSON.stringify(type)}`));
    }
    this.served.set(type as string, (this.served.get(type as string) ?? 0) + 1);
    return Promise.resolve(JSON.parse(body) as T);
  }
}

/**
 * Minimal `WebSocket` stand-in installed over `globalThis.WebSocket`.
 *
 * Opens on a microtask (so `await transport.ready()` works), records outgoing
 * frames, and auto-answers frames exactly like the real server does:
 * - `subscribe` / `unsubscribe` get a `subscriptionResponse` echo;
 * - `post` gets a `post` response carrying {@linkcode MockWebSocket.postData} for `info`
 *   requests and {@linkcode ORDER_SUCCESS} for `action` requests.
 *
 * Server-to-client frames are injected with {@linkcode MockWebSocket.serverSend}.
 */
export class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  binaryType: BinaryType = "blob";
  readyState: 0 | 1 | 2 | 3 = 0; // CONNECTING
  readonly sentMessages: string[] = [];
  /** Payload returned as the `data` of an auto-answered `info` `post` response. */
  postData: unknown = {};

  constructor(url: string | URL, _protocols?: string | string[]) {
    super();
    this.url = String(url);
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1; // OPEN
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const text = typeof data === "string" ? data : String(data);
    this.sentMessages.push(text);

    let frame: { method?: string; subscription?: unknown; id?: number; request?: unknown };
    try {
      frame = JSON.parse(text);
    } catch {
      return; // not JSON: nothing to auto-answer
    }
    if (frame?.method === "subscribe" || frame?.method === "unsubscribe") {
      const confirmation = {
        channel: "subscriptionResponse",
        data: { method: frame.method, subscription: frame.subscription },
      };
      // Asynchronous echo: the dispatcher registers the pending request
      // synchronously right after `send()` returns, so a microtask is safe.
      queueMicrotask(() => this.serverSend(confirmation));
      return;
    }
    if (frame?.method === "post" && typeof frame.id === "number") {
      const { id } = frame;
      const wrapped = frame.request as { type?: string; payload?: { type?: string } } | undefined;
      const response =
        wrapped?.type === "action"
          ? { type: "action", payload: ORDER_SUCCESS }
          : { type: "info", payload: { type: wrapped?.payload?.type ?? "unknown", data: this.postData } };
      queueMicrotask(() => this.serverSend({ channel: "post", data: { id, response } }));
    }
  }

  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 3; // CLOSED
    this.dispatchEvent(new CloseEvent("close", { code: 1000, wasClean: true }));
  }

  /** Injects a server-to-client frame (a raw payload object, JSON-encoded here). */
  serverSend(payload: unknown): void {
    if (this.readyState !== 1) return;
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

const OriginalWebSocket: typeof globalThis.WebSocket = globalThis.WebSocket;

/** Replaces `globalThis.WebSocket` with {@linkcode MockWebSocket} (picked up by `@nktkas/rews`). */
export function installMockWebSocket(): void {
  MockWebSocket.instances = [];
  // The mock implements only what the transport touches, so it is not structurally a
  // `WebSocket`; the double assertion is the whole point of installing a stand-in.
  globalThis.WebSocket = MockWebSocket as unknown as typeof globalThis.WebSocket;
}

/** Restores the original `globalThis.WebSocket`. */
export function restoreWebSocket(): void {
  globalThis.WebSocket = OriginalWebSocket;
}

/** Returns the most recently created {@linkcode MockWebSocket} (i.e. the one backing the transport). */
export function lastMockWebSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) throw new Error("No MockWebSocket instance was created");
  return socket;
}
