/** Regression coverage for sharing the lazy inner Agent digest across L1 multi-sig signers. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { privateKeyToAccount } from "viem/accounts";
import { signMultiSigL1 } from "@bloxwap/hyperliquid/signing";
import { SIGN_DIGEST_BYTES } from "../../src/signing/_abstractWallet.ts";
import { _setKeccakLoaderForTests, preloadWasmKeccak } from "../../src/signing/_keccak.ts";

const accounts = Array.from({ length: 8 }, (_, i) =>
  privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, "0")}`),
);
const args = {
  multiSigUser: "0x1234567890123456789012345678901234567890",
  signatureChainId: "0x66eee",
  action: { type: "cancel", cancels: [{ a: 0, o: 42 }] },
  nonce: 1700000000000,
} as const;
const typedOnly = (account: (typeof accounts)[number]) => ({
  address: account.address,
  signTypedData: (params: never) => account.signTypedData(params),
});

describe("L1 multi-sig shared inner digest", () => {
  const hashLengths: number[] = [];
  beforeEach(async () => {
    // Count real hashes without relying on the optional WASM dependency or global module mocks.
    let hasher = keccak_256.create();
    let length = 0;
    _setKeccakLoaderForTests(async () => ({
      init(): void {
        hasher = keccak_256.create();
        length = 0;
      },
      update(bytes: Uint8Array): void {
        length += bytes.length;
        hasher.update(bytes);
      },
      digest(_outputType: "binary"): Uint8Array {
        hashLengths.push(length);
        return hasher.digest();
      },
    }));
    await preloadWasmKeccak();
    hashLengths.length = 0; // Exclude provider validation.
  });
  afterEach(() => _setKeccakLoaderForTests(undefined));

  test("one inner struct and envelope hash serve 1, 3, or 8 raw signers on either network", async () => {
    for (const count of [1, 3, 8]) {
      const [leader, ...others] = accounts.slice(0, count);
      for (const isTestnet of [false, true]) {
        hashLengths.length = 0;
        await signMultiSigL1({ ...args, signers: [leader, ...others], isTestnet });
        expect(hashLengths.filter((length) => length === 96)).toHaveLength(1); // Agent struct.
        expect(hashLengths.filter((length) => length === 66)).toHaveLength(2); // Inner + outer envelopes.
      }
    }
  });

  test("typed-data-only signers never compute an unused inner digest", async () => {
    await signMultiSigL1({
      ...args,
      signers: [typedOnly(accounts[0]), typedOnly(accounts[1]), typedOnly(accounts[2])],
    });
    expect(hashLengths.filter((length) => length === 96)).toHaveLength(0);
    expect(hashLengths.filter((length) => length === 66)).toHaveLength(0);
  });

  test("mixed capabilities keep oracle signatures across networks and fresh nonces", async () => {
    for (const isTestnet of [false, true]) {
      for (const nonce of [args.nonce, args.nonce + 1]) {
        const options = { ...args, isTestnet, nonce };
        hashLengths.length = 0;
        const mixed = await signMultiSigL1({
          ...options,
          signers: [accounts[0], typedOnly(accounts[1]), accounts[2]],
        });
        expect(hashLengths.filter((length) => length === 96)).toHaveLength(1);
        const oracle = await signMultiSigL1({
          ...options,
          signers: [typedOnly(accounts[0]), typedOnly(accounts[1]), typedOnly(accounts[2])],
        });
        expect(mixed).toEqual(oracle);
      }
    }
  });

  test("a bytes-capable signer cannot mutate the cached input of another signer", async () => {
    const leader = {
      ...typedOnly(accounts[0]),
      [SIGN_DIGEST_BYTES]: (digest: Uint8Array): Promise<`0x${string}`> => {
        const signature = accounts[0].sign({ hash: `0x${bytesToHex(digest)}` });
        digest.fill(0);
        return signature;
      },
    };
    const actual = await signMultiSigL1({ ...args, signers: [leader, accounts[1], accounts[2]] });
    const oracle = await signMultiSigL1({
      ...args,
      signers: [typedOnly(accounts[0]), typedOnly(accounts[1]), typedOnly(accounts[2])],
    });
    expect(actual).toEqual(oracle);
  });
});
