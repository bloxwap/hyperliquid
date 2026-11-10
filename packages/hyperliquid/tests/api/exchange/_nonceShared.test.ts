/**
 * The default nonce manager is one map per signer for every client and every copy of the module
 * in this realm.
 * @module
 */

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { executeWithShell } from "../../../src/api/exchange/_methods/_base/_shell.ts";
import {
  createNonceManager,
  globalNonceManager,
  type NonceManager,
} from "../../../src/api/exchange/_methods/_base/_nonce.ts";

const SIGNATURE = `0x${"11".repeat(64)}1b` as const;
const built = { action: { type: "test" }, signature: { r: "0x1" as const, s: "0x2" as const, v: 27 as const } };

test("two ExchangeClients in one process do not reuse a nonce for the same signer in one tick", async () => {
  const frozen = 1_810_000_000_000;
  const real = Date.now;
  Date.now = () => frozen;
  const address = "0x5151515151515151515151515151515151515151" as const;
  const posts: number[] = [];
  const transport = {
    isTestnet: false,
    request: async <T>(_endpoint: "info" | "exchange", body: unknown): Promise<T> => {
      posts.push((body as { nonce: number }).nonce);
      return { status: "ok", response: { type: "default" } } as T;
    },
  };
  const wallet = { address, signTypedData: async () => SIGNATURE };
  try {
    await executeWithShell({ wallet, transport }, async () => built);
    await executeWithShell({ wallet, transport }, async () => built);
  } finally {
    Date.now = real;
  }
  expect(posts).toEqual([frozen, frozen + 1]);
});

test("a private createNonceManager does not share the realm map", () => {
  const frozen = 1_820_000_000_000;
  const real = Date.now;
  Date.now = () => frozen;
  const key = "private-manager-isolation";
  try {
    const fromGlobal = globalNonceManager.getNonce(key);
    const local = createNonceManager();
    // Same clock, separate map: both may issue `frozen`. That is the collision the shared
    // manager exists to prevent, and a private manager is allowed to have it.
    expect(local.getNonce(key)).toBe(fromGlobal);
    expect(globalNonceManager.getNonce(key)).toBe(frozen + 1);
    expect(local.getNonce(key)).toBe(frozen + 1);
  } finally {
    Date.now = real;
  }
});

test("two copies of the nonce module share issuance for one key", async () => {
  const runtimeUrl = pathToFileURL(new URL("../../../src/transport/runtime.ts", import.meta.url).pathname).href;
  const source = readFileSync(
    new URL("../../../src/api/exchange/_methods/_base/_nonce.ts", import.meta.url),
    "utf8",
  ).replace('from "../../../../transport/runtime.ts"', `from ${JSON.stringify(runtimeUrl)}`);
  const dir = join(tmpdir(), `hl-nonce-copies-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const copyA = join(dir, "copy-a.ts");
  const copyB = join(dir, "copy-b.ts");
  writeFileSync(copyA, source);
  writeFileSync(copyB, source);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  try {
    const [a, b] = await Promise.all([
      import(pathToFileURL(copyA).href) as Promise<{ globalNonceManager: NonceManager }>,
      import(pathToFileURL(copyB).href) as Promise<{ globalNonceManager: NonceManager }>,
    ]);
    const frozen = 1_830_000_000_000;
    const real = Date.now;
    Date.now = () => frozen;
    const key = "two-module-copies";
    try {
      const first = a.globalNonceManager.getNonce(key);
      const second = b.globalNonceManager.getNonce(key);
      expect(second).toBe(first + 1);
    } finally {
      Date.now = real;
    }
  } finally {
    console.warn = originalWarn;
  }
  const duplicateWarnings = warnings.filter((line) => line.includes("More than one copy of this package"));
  expect(duplicateWarnings.length).toBeLessThanOrEqual(1);
  const state = (globalThis as Record<symbol, { duplicateWarned?: boolean } | undefined>)[
    Symbol.for("@bloxwap/hyperliquid/nonce-state")
  ];
  expect(state?.duplicateWarned).toBe(true);
});
