/**
 * Shared helpers for live Info API tests.
 * @module
 */

import { test } from "bun:test";
import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";
import { OFFLINE } from "../../_offline.ts";
import { createTestContext, type TestContext } from "../../_testContext.ts";

// ============================================================
// Arguments
// ============================================================

const WAIT = 5000;

/** Generous per-test budget: every case pays the rate-limit delay plus one or more testnet round trips. */
const TIMEOUT = 120_000;

// ============================================================
// Preparation
// ============================================================

const transport = new HttpTransport({ isTestnet: true, timeout: 30_000 });
const client = new InfoClient({ transport });

// ============================================================
// Test
// ============================================================

/**
 * Runs an info API test with rate-limit delay and shared client.
 *
 * @param options Test options including name and test function
 * @param options.name Name of the test
 * @param options.ignore Whether to skip the test
 * @param options.codeTestFn Async function containing the test code, receives a test context and shared InfoClient
 */
export function runTest(options: {
  name: string;
  ignore?: boolean;
  codeTestFn: (t: TestContext, client_: typeof client) => Promise<void>;
}): void {
  const { name, ignore, codeTestFn } = options;

  test.skipIf(OFFLINE || ignore === true)(
    name,
    async () => {
      await new Promise((r) => setTimeout(r, WAIT)); // delay to avoid rate limits

      await codeTestFn(createTestContext([name]), client);
    },
    TIMEOUT,
  );
}
