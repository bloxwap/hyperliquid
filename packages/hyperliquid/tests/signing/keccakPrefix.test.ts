/** Differential checks for resumable Keccak preimages, including provider transitions. @module */
import { afterEach, expect, test } from "bun:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  createKeccakPrefix,
  _setKeccakLoaderForTests,
  preloadWasmKeccak,
  keccak256,
} from "../../src/signing/_keccak.ts";
import { createL1ActionHash } from "../../src/signing/_l1.ts";
import { buildOrder } from "../../src/api/exchange/_methods/order.ts";

afterEach(() => _setKeccakLoaderForTests(undefined));

function checkPrefixes(): void {
  for (const length of [0, 1, 127, 128, 135, 136, 137, 255, 256, 271, 272, 273, 4096, 65536]) {
    const prefix = Uint8Array.from({ length }, (_, i) => (i * 13 + length) & 255);
    const digest = createKeccakPrefix(prefix);
    for (const size of [0, 1, 9, 29, 38, 135, 136, 137]) {
      const tail = Uint8Array.from({ length: size }, (_, i) => (i * 17 + size) & 255);
      const expected = keccak_256.create().update(prefix).update(tail).digest();
      expect(digest(tail)).toEqual(expected);
      keccak256(new Uint8Array(500).fill(size));
      expect(digest(tail)).toEqual(expected);
    }
  }
}

test("prefixes match complete Keccak with the optional provider absent", async () => {
  _setKeccakLoaderForTests(async () => undefined);
  await preloadWasmKeccak();
  checkPrefixes();
});

test("prefixes match complete Keccak with the real optional provider", async () => {
  _setKeccakLoaderForTests(undefined);
  await preloadWasmKeccak();
  checkPrefixes();
});

test("an existing prefix remains correct across noble/WASM/provider-instance changes", async () => {
  const prefix = new Uint8Array(4097).fill(0x41);
  const tail = new Uint8Array(38).fill(0x59);
  const expected = keccak_256.create().update(prefix).update(tail).digest();
  _setKeccakLoaderForTests(async () => undefined);
  const digest = createKeccakPrefix(prefix);
  expect(digest(tail)).toEqual(expected);
  for (const real of [true, false, true]) {
    _setKeccakLoaderForTests(real ? undefined : async () => undefined);
    await preloadWasmKeccak();
    expect(digest(tail)).toEqual(expected);
  }
});

test("broken save/load cannot corrupt a valid one-shot provider", async () => {
  let data = new Uint8Array(0);
  _setKeccakLoaderForTests(async () => ({
    init: () => {
      data = new Uint8Array(0);
    },
    update: (bytes) => {
      data = Uint8Array.from([...data, ...bytes]);
    },
    digest: () => keccak_256(data),
    save: () => new Uint8Array(0),
    load: () => {
      data = new Uint8Array(0);
    },
  }));
  await preloadWasmKeccak();
  checkPrefixes();
});

test("owned action checkpoints keep metadata fresh after provider changes", async () => {
  const input = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };
  const action = buildOrder({ orders: Array.from({ length: 100 }, () => input) });
  const fresh = structuredClone(action.payload);
  for (const real of [false, true, false, true]) {
    _setKeccakLoaderForTests(real ? undefined : async () => undefined);
    await preloadWasmKeccak();
    for (const nonce of [0, 1, 255, 0xffffffff, 0x100000000, 1_700_000_000_000, Number.MAX_SAFE_INTEGER]) {
      for (const vaultAddress of [undefined, "0x3333333333333333333333333333333333333333" as const]) {
        for (const expiresAfter of [undefined, 0, nonce + 100]) {
          const args = { nonce, vaultAddress, expiresAfter };
          expect(createL1ActionHash({ ...args, action: action.payload })).toBe(
            createL1ActionHash({ ...args, action: fresh }),
          );
        }
      }
    }
  }
});
