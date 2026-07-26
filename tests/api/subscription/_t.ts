/**
 * Shared helpers for live Subscription API tests.
 * @module
 */

import { test } from "bun:test";
import {
  type ExchangeClient,
  type ExchangeMultiSigConfig,
  type ExchangeSingleWalletConfig,
  InfoClient,
  SubscriptionClient,
  WebSocketTransport,
} from "@bloxwap/hyperliquid";
import { OFFLINE } from "../../_offline.ts";
import { createTestContext, type TestContext } from "../../_testContext.ts";
import { cleanupTempExchangeClient, createTempExchangeClient } from "../exchange/_t.ts";

// =============================================================
// Arguments
// =============================================================

const WAIT = 5000;

/** Generous per-test budget: every case pays the rate-limit delay plus a live WebSocket session. */
const TIMEOUT = 120_000;

// =============================================================
// Test
// =============================================================

/**
 * Runs a subscription test against a live testnet WebSocket endpoint.
 *
 * @param options Test options.
 * @param options.name Name of the subscription under test.
 * @param options.mode Which testnet host to connect to: the API or the RPC gateway.
 * @param options.fn Test body; receives a test context and a connected `SubscriptionClient`.
 */
export function runTest(options: {
  name: string;
  mode: "api" | "rpc";
  fn: (t: TestContext, client: SubscriptionClient) => Promise<void>;
}): void {
  const { name, mode, fn } = options;

  test.skipIf(OFFLINE)(
    name,
    async () => {
      await new Promise((r) => setTimeout(r, WAIT)); // delay to avoid rate limits

      // --- Preparation ------------------------------------------------

      const transport = new WebSocketTransport({ url: `wss://${mode}.hyperliquid-testnet.xyz/ws`, isTestnet: true });
      await transport.ready();
      const subsClient = new SubscriptionClient({ transport });

      // --- Test ------------------------------------------------

      await fn(createTestContext([name]), subsClient).finally(() => {
        // --- Cleanup ------------------------------------------------

        transport.close();
      });
    },
    TIMEOUT,
  );
}

/**
 * Runs a subscription test that also needs to place real actions from a temporary funded account.
 *
 * @param options Test options.
 * @param options.name Name of the subscription under test.
 * @param options.fn Test body; receives a test context plus subscription, exchange and info clients.
 */
export function runTestWithExchange(options: {
  name: string;
  fn: (
    t: TestContext,
    client: {
      subs: SubscriptionClient;
      exch: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>;
      info: InfoClient;
    },
  ) => Promise<void>;
}): void {
  const { name, fn } = options;

  test.skipIf(OFFLINE)(
    name,
    async () => {
      await new Promise((r) => setTimeout(r, WAIT)); // delay to avoid rate limits

      // --- Preparation ------------------------------------------------

      const transport = new WebSocketTransport({ isTestnet: true });
      await transport.ready();

      const exchClient = await createTempExchangeClient("user");
      const infoClient = new InfoClient({ transport });
      const subsClient = new SubscriptionClient({ transport });

      // --- Test ------------------------------------------------

      await fn(createTestContext([name]), { subs: subsClient, exch: exchClient, info: infoClient }).finally(
        async () => {
          // --- Cleanup ------------------------------------------------

          await cleanupTempExchangeClient(exchClient);
          transport.close();
        },
      );
    },
    TIMEOUT,
  );
}

// =============================================================
// Helpers
// =============================================================

export { createTWAP, openOrder } from "../exchange/_t.ts";

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
