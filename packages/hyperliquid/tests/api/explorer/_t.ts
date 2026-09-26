/**
 * Shared helpers for live Explorer API tests.
 * @module
 */

import { test } from "bun:test";
import { ExplorerClient, HttpTransport, WebSocketTransport } from "@bloxwap/hyperliquid";
import { OFFLINE } from "../../_offline.ts";
import { createTestContext, type TestContext } from "../../_testContext.ts";

// =============================================================================
// Arguments
// =============================================================================

const WAIT = 5000;

/** Generous per-test budget: every case pays the rate-limit delay plus one or more testnet round trips. */
const TIMEOUT = 120_000;

// =============================================================================
// Test
// =============================================================================

/**
 * Runs an explorer HTTP-request test on an `HttpTransport` (testnet RPC URL by default).
 */
export function runRequestTest(options: {
  name: string;
  /** Uses the testnet RPC when true; defaults to `true`. */
  isTestnet?: boolean;
  fn: (t: TestContext, client: ExplorerClient<HttpTransport>) => Promise<void>;
}): void {
  const { name, isTestnet = true, fn } = options;

  test.skipIf(OFFLINE)(
    name,
    async () => {
      await new Promise((r) => setTimeout(r, WAIT)); // delay to avoid rate limits

      const transport = new HttpTransport({ isTestnet });
      const client = new ExplorerClient({ transport });

      await fn(createTestContext([name]), client);
    },
    TIMEOUT,
  );
}

/**
 * Runs an explorer WebSocket-subscription test on a `WebSocketTransport` (testnet RPC URL).
 */
export function runSubscriptionTest(options: {
  name: string;
  fn: (t: TestContext, client: ExplorerClient<WebSocketTransport>) => Promise<void>;
}): void {
  const { name, fn } = options;

  test.skipIf(OFFLINE)(
    name,
    async () => {
      await new Promise((r) => setTimeout(r, WAIT)); // delay to avoid rate limits

      const transport = new WebSocketTransport({ url: "wss://rpc.hyperliquid-testnet.xyz/ws", isTestnet: true });
      await transport.ready();
      const client = new ExplorerClient({ transport });

      await fn(createTestContext([name]), client).finally(() => {
        transport.close();
      });
    },
    TIMEOUT,
  );
}

// =============================================================================
// Helpers
// =============================================================================

/** Collects events for a fixed interval after asynchronous setup completes. */
export async function collectEventsOverTime<T>(
  fn: (cb: (event: T) => void) => void | Promise<void>,
  durationMs: number,
): Promise<T[]> {
  const data: T[] = [];
  await fn((event) => data.push(event));
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  return data;
}
