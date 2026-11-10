/**
 * Nonce and `expiresAfter` are millisecond timestamps inside the protocol window in every
 * dispatch mode, not only bounded mode.
 * @module
 */

import { expect, test } from "bun:test";
import { HyperliquidError } from "../../../src/_errors.ts";
import type { ExchangeConfig } from "../../../src/api/exchange/_methods/_base/_config.ts";
import { type BuildResult, executeWithShell } from "../../../src/api/exchange/_methods/_base/_shell.ts";
import { order, type OrderParameters } from "../../../src/api/exchange/_methods/order.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const SIGNATURE = `0x${"11".repeat(64)}1b` as const;
const built: BuildResult = { action: { type: "test" }, signature: { r: "0x1", s: "0x2", v: 27 } };
const LIMIT: OrderParameters = {
  orders: [{ a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
};

let walletId = 0;
function address(): `0x${string}` {
  return `0x${(++walletId).toString(16).padStart(40, "0")}`;
}

function config(nonce: number): { config: ExchangeConfig; posted: () => number } {
  let posts = 0;
  return {
    posted: () => posts,
    config: {
      wallet: { address: address(), signTypedData: async () => SIGNATURE },
      runtime: { now: () => NOW },
      nonceManager: () => nonce,
      transport: {
        isTestnet: true,
        request: async <T>(): Promise<T> => {
          posts++;
          return { status: "ok", response: { type: "default" } } as T;
        },
      },
    },
  };
}

test("a seconds-scale nonce is rejected in the default ordered mode before anything is signed", async () => {
  const harness = config(Math.floor(NOW / 1000));
  const error = await executeWithShell(harness.config, async () => built).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HyperliquidError);
  expect(String(error)).toMatch(/millisecond timestamp/);
  expect(harness.posted()).toBe(0);
});

test("a fractional nonce is a HyperliquidError, not a msgpack RangeError", async () => {
  const harness = config(NOW + 0.5);
  await expect(executeWithShell(harness.config, async () => built)).rejects.toThrow(
    /safe integer millisecond timestamp/,
  );
  expect(harness.posted()).toBe(0);
});

test("nonces outside the protocol window are rejected from both sides", async () => {
  const stale = config(NOW - 2 * DAY);
  await expect(executeWithShell(stale.config, async () => built)).rejects.toThrow(/timestamp window/);
  const lead = config(NOW + DAY);
  await expect(executeWithShell(lead.config, async () => built)).rejects.toThrow(/timestamp window/);
  const ok = config(NOW);
  await executeWithShell(ok.config, async () => built);
  expect(ok.posted()).toBe(1);
});

test("expiresAfter in the past, in seconds, or more than a day ahead is rejected before the wire", async () => {
  const harness = config(NOW);
  await expect(
    executeWithShell(harness.config, async () => ({ ...built, extras: { expiresAfter: NOW - 1 } })),
  ).rejects.toThrow(/expired/);
  await expect(
    executeWithShell(harness.config, async () => ({ ...built, extras: { expiresAfter: Math.floor(NOW / 1000) } })),
  ).rejects.toThrow(/millisecond timestamp/);
  await expect(
    executeWithShell(harness.config, async () => ({ ...built, extras: { expiresAfter: NOW + DAY } })),
  ).rejects.toThrow(/timestamp window/);
  await executeWithShell(harness.config, async () => ({ ...built, extras: { expiresAfter: NOW + 60_000 } }));
  expect(harness.posted()).toBe(1);
});

test("skipValidation still rejects a seconds-scale expiresAfter and posts nothing", async () => {
  const posts: unknown[] = [];
  const exchange: ExchangeConfig = {
    wallet: { address: address(), signTypedData: async () => SIGNATURE },
    runtime: { now: () => NOW },
    nonceManager: () => NOW,
    transport: {
      isTestnet: true,
      request: async <T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> => {
        posts.push(payload);
        return { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } } as T;
      },
    },
  };
  await expect(order(exchange, LIMIT, { expiresAfter: Math.floor(NOW / 1000), skipValidation: true })).rejects.toThrow(
    /millisecond timestamp/,
  );
  expect(posts).toHaveLength(0);
});
