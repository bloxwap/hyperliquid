import { expect, test } from "bun:test";
import { buildOrder } from "../../src/api/exchange/_methods/order.ts";
import { buildCancel } from "../../src/api/exchange/_methods/cancel.ts";
import { createL1ActionHash, signL1Action } from "../../src/signing/_l1.ts";
import { signAction } from "../../src/actions/execution.ts";
import { privateKeyToAccount } from "viem/accounts";
import { createFastLocalWallet } from "../../src/signing/_fastWallet.ts";

const nonce = 1_700_000_000_000;
const vault = "0x3333333333333333333333333333333333333333" as const;
const input = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };

test("immutable byte reuse preserves hashes across batch headers, nonces, vaults, and expiry", () => {
  for (const count of [1, 15, 16, 39, 40, 100]) {
    const actions = [
      buildOrder({ orders: Array.from({ length: count }, (_, i) => ({ ...input, a: i, p: `${30000 + i}` })) }),
      buildCancel({ cancels: Array.from({ length: count }, (_, i) => ({ a: i, o: nonce + i })) }),
    ];
    for (const action of actions) {
      for (const offset of [0, 1, 1000]) {
        for (const vaultAddress of [undefined, vault]) {
          for (const expiresAfter of [undefined, nonce + 60_000]) {
            const args = { nonce: nonce + offset, vaultAddress, expiresAfter };
            expect(createL1ActionHash({ ...args, action: action.payload })).toBe(
              createL1ActionHash({ ...args, action: structuredClone(action.payload) }),
            );
          }
        }
      }
    }
  }
});

test("ordinary and shallow-frozen signing inputs never reuse stale nested bytes", () => {
  for (const freeze of [false, true]) {
    const payload = structuredClone(buildOrder({ orders: [input] }).payload) as {
      type: string;
      orders: (typeof input)[];
    };
    if (freeze) Object.freeze(payload);
    const before = createL1ActionHash({ action: payload, nonce });
    payload.orders[0].p = "31000";
    const after = createL1ActionHash({ action: payload, nonce });
    expect(after).not.toBe(before);
    expect(after).toBe(createL1ActionHash({ action: structuredClone(payload), nonce }));
  }
});

test("a reentrant getter hashing a cached payload cannot corrupt the outer preimage", () => {
  const owned = buildOrder({ orders: [input] });
  const expectedInner = createL1ActionHash({ action: owned.payload, nonce });
  const outer = {
    type: "example",
    get nested(): string {
      expect(createL1ActionHash({ action: owned.payload, nonce })).toBe(expectedInner);
      return "value";
    },
  };
  expect(createL1ActionHash({ action: outer, nonce })).toBe(
    createL1ActionHash({ action: { type: "example", nested: "value" }, nonce }),
  );
});

test("reused action signatures still match fresh serialization on both networks and signer implementations", async () => {
  const action = buildOrder({ orders: Array.from({ length: 40 }, () => input) });
  for (const wallet of [
    privateKeyToAccount(`0x${"11".repeat(32)}`),
    await createFastLocalWallet(`0x${"11".repeat(32)}`),
  ]) {
    for (const isTestnet of [false, true]) {
      const config = {
        wallet,
        nonceManager: () => nonce,
        transport: {
          isTestnet,
          async request<T>(): Promise<T> {
            throw new Error("signAction must not dispatch");
          },
        },
      };
      const first = await signAction(config, action, { vaultAddress: vault, expiresAfter: nonce + 60_000 });
      const second = await signAction(config, action, { vaultAddress: vault, expiresAfter: nonce + 60_000 });
      const fresh = await signL1Action({
        wallet,
        action: structuredClone(action.payload),
        nonce,
        isTestnet,
        vaultAddress: vault,
        expiresAfter: nonce + 60_000,
      });
      expect(first.signature).toEqual(second.signature);
      expect(first.signature).toEqual(fresh);
    }
  }
});
