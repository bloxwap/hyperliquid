/**
 * Tests for the signing warm-up (`warmupSigning`, `ExchangeClient.warmup`) and the keccak preload.
 *
 * The property that matters most is the negative one: warm-up signs throwaway data, so it must never
 * reach a wallet whose key may live outside the process — a JSON-RPC wallet can prompt the user, and a
 * custom signer (HSM, MPC, remote service) is billed or logged per signature. Every wallet here is
 * instrumented to count signatures, and those tests assert the count is exactly zero.
 * @module
 */

import { afterEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount, toAccount } from "viem/accounts";

import { ExchangeClient } from "@bloxwap/hyperliquid";
import {
  type AbstractViemJsonRpcAccount,
  type AbstractWallet,
  AbstractWalletError,
  createFastLocalWallet,
  preloadWasmKeccak,
  warmupSigning,
} from "@bloxwap/hyperliquid/signing";
import { SIGN_DIGEST_BYTES } from "../../src/signing/_abstractWallet.ts";
import { _setKeccakLoaderForTests } from "../../src/signing/_keccak.ts";
import { recordingTransport } from "../api/exchange/_mockTransport.ts";

const PRIVATE_KEY = `0x${"07".repeat(32)}` as const;
const SIGNATURE = `0x${"11".repeat(64)}1b` as const;

const tinySecp256k1Available = await import("tiny-secp256k1").then(
  () => true,
  () => false,
);

/** A real `privateKeyToAccount` account whose `sign` / `signTypedData` calls are counted. */
function countedPrivateKeyAccount(): { wallet: AbstractWallet; calls: { sign: number; typed: number } } {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const calls = { sign: 0, typed: 0 };
  const sign = account.sign;
  const signTypedData = account.signTypedData;
  const wallet = {
    ...account,
    sign: (args: Parameters<typeof sign>[0]) => {
      calls.sign++;
      return sign(args);
    },
    signTypedData: ((args: Parameters<typeof signTypedData>[0]) => {
      calls.typed++;
      return signTypedData(args);
    }) as typeof signTypedData,
  };
  return { wallet, calls };
}

/** A viem `toAccount` custom signer (the HSM / MPC / remote shape), counting every signature request. */
function countedCustomAccount(): { wallet: AbstractWallet; calls: { sign: number; typed: number } } {
  const calls = { sign: 0, typed: 0 };
  const wallet = toAccount({
    address: privateKeyToAccount(PRIVATE_KEY).address,
    sign: () => {
      calls.sign++;
      return Promise.resolve(SIGNATURE);
    },
    signMessage: () => Promise.resolve(SIGNATURE),
    signTransaction: () => Promise.resolve(SIGNATURE),
    signTypedData: () => {
      calls.typed++;
      return Promise.resolve(SIGNATURE);
    },
  });
  return { wallet, calls };
}

/** A JSON-RPC-shaped wallet (e.g. a browser wallet client), counting every signature request. */
function countedJsonRpcWallet(): { wallet: AbstractViemJsonRpcAccount; calls: { typed: number } } {
  const calls = { typed: 0 };
  const wallet: AbstractViemJsonRpcAccount = {
    signTypedData: () => {
      calls.typed++;
      return Promise.resolve(SIGNATURE);
    },
    getAddresses: () => Promise.resolve([privateKeyToAccount(PRIVATE_KEY).address]),
    getChainId: () => Promise.resolve(1),
  };
  return { wallet, calls };
}

afterEach(() => {
  _setKeccakLoaderForTests(undefined);
});

describe("warmupSigning", () => {
  test("signs throwaway data with a privateKeyToAccount wallet, via the raw-digest path", async () => {
    const { wallet, calls } = countedPrivateKeyAccount();
    await warmupSigning(wallet);
    expect(calls.sign).toBeGreaterThan(0);
    expect(calls.typed).toBe(0);
  });

  test("never asks a custom (toAccount) signer to sign", async () => {
    const { wallet, calls } = countedCustomAccount();
    await warmupSigning(wallet);
    expect(calls).toEqual({ sign: 0, typed: 0 });
  });

  test("never asks a JSON-RPC wallet to sign", async () => {
    const { wallet, calls } = countedJsonRpcWallet();
    await warmupSigning(wallet);
    expect(calls.typed).toBe(0);
  });

  test("signs through a WalletClient-shaped wallet only when its embedded account holds the key", async () => {
    const local = countedPrivateKeyAccount();
    const remote = countedJsonRpcWallet();
    await warmupSigning({ ...remote.wallet, account: local.wallet } as unknown as AbstractWallet);
    expect(local.calls.sign).toBeGreaterThan(0);
    expect(remote.calls.typed).toBe(0);

    const custom = countedCustomAccount();
    const remote2 = countedJsonRpcWallet();
    await warmupSigning({ ...remote2.wallet, account: custom.wallet } as unknown as AbstractWallet);
    expect(custom.calls).toEqual({ sign: 0, typed: 0 });
    expect(remote2.calls.typed).toBe(0);
  });

  test("handles a list of wallets, signing only with the in-process ones", async () => {
    const local = countedPrivateKeyAccount();
    const custom = countedCustomAccount();
    await warmupSigning([custom.wallet, local.wallet]);
    expect(local.calls.sign).toBeGreaterThan(0);
    expect(custom.calls).toEqual({ sign: 0, typed: 0 });
  });

  test.if(tinySecp256k1Available)(
    "signs with a createFastLocalWallet wallet via its bytes-level capability",
    async () => {
      const wallet = await createFastLocalWallet(PRIVATE_KEY);
      const capability = (wallet as unknown as Record<symbol, (digest: Uint8Array) => Promise<`0x${string}`>>)[
        SIGN_DIGEST_BYTES
      ];
      let calls = 0;
      (wallet as unknown as Record<symbol, unknown>)[SIGN_DIGEST_BYTES] = (digest: Uint8Array) => {
        calls++;
        return capability(digest);
      };
      await warmupSigning(wallet);
      expect(calls).toBeGreaterThan(0);
    },
  );

  test("propagates a signing failure from an in-process wallet", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const wallet = { ...account, sign: () => Promise.reject(new Error("boom")) };
    const error = await warmupSigning(wallet).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AbstractWalletError);
    expect((error as Error).cause).toEqual(new Error("boom"));
  });

  test("with no wallet, waits for the keccak load to settle", async () => {
    let settled = false;
    _setKeccakLoaderForTests(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      settled = true;
      return undefined;
    });
    await warmupSigning();
    expect(settled).toBe(true);
  });
});

describe("preloadWasmKeccak", () => {
  test("resolves even when the WASM module is unavailable", async () => {
    _setKeccakLoaderForTests(() => Promise.reject(new Error("missing")));
    await expect(preloadWasmKeccak()).resolves.toBeUndefined();
  });
});

describe("ExchangeClient", () => {
  test("starts the keccak load on construction", () => {
    let loads = 0;
    _setKeccakLoaderForTests(() => {
      loads++;
      return Promise.resolve(undefined);
    });
    new ExchangeClient({ transport: recordingTransport().transport, wallet: privateKeyToAccount(PRIVATE_KEY) });
    expect(loads).toBe(1);
  });

  test("warmup() signs with the wallet and sends nothing", async () => {
    const { transport, calls: requests } = recordingTransport();
    const { wallet, calls } = countedPrivateKeyAccount();
    const client = new ExchangeClient({ transport, wallet });
    await client.warmup();
    expect(calls.sign).toBeGreaterThan(0);
    expect(requests).toHaveLength(0);
  });

  test("warmup() on a multi-sig client warms every in-process signer and skips the rest", async () => {
    const { transport, calls: requests } = recordingTransport();
    const local = countedPrivateKeyAccount();
    const custom = countedCustomAccount();
    const client = new ExchangeClient({
      transport,
      signers: [local.wallet, custom.wallet],
      multiSigUser: "0x0000000000000000000000000000000000000001",
    });
    await client.warmup();
    expect(local.calls.sign).toBeGreaterThan(0);
    expect(custom.calls).toEqual({ sign: 0, typed: 0 });
    expect(requests).toHaveLength(0);
  });
});
