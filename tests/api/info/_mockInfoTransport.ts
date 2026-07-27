/**
 * Mock transport for offline Info API tests.
 *
 * Answers `info` requests from a scripted handler instead of the network and records every call,
 * so pagination tests can assert both the concatenated result and the exact sequence of
 * `startTime` values the helper paged through.
 *
 * @module
 */

import type { IRequestTransport } from "@bloxwap/hyperliquid";

/** One recorded request, after request-schema validation (so `type` is always set). */
export interface MockInfoCall {
  endpoint: "info" | "exchange";
  payload: unknown;
}

/** An {@linkcode IRequestTransport} that serves canned responses for offline tests. */
export class MockInfoTransport implements IRequestTransport {
  readonly isTestnet = true;
  readonly calls: MockInfoCall[] = [];

  constructor(readonly handler: (payload: Record<string, unknown>) => unknown) {}

  request<T>(endpoint: "info" | "exchange", payload: unknown, _signal?: AbortSignal): Promise<T> {
    this.calls.push({ endpoint, payload });
    return Promise.resolve(this.handler(payload as Record<string, unknown>) as T);
  }
}

/** Returns a handler that serves `pages` in order, then empty pages forever. */
export function scriptedPages(pages: unknown[][]): (payload: Record<string, unknown>) => unknown[] {
  const queue = [...pages];
  return () => queue.shift() ?? [];
}
