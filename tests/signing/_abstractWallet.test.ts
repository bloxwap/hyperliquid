/**
 * Wallet-shape detection in the signer adapter (issue #92): the guards match on member PRESENCE
 * only, never on `Function.length` — that value counts declared parameters before the first
 * default/rest parameter, so wrapped or adapted wallets (a Privy-style embedded-wallet adapter
 * declaring `signTypedData(...args)`) report length 0 and used to fail both guards with an opaque
 * "unknown wallet type" error. This suite pins:
 *
 * 1. length-0 adapters adapt as JSON-RPC / local and sign byte-identically to the wrapped account;
 * 2. the one shape arity DID usefully catch — positional ethers-style
 *    `signTypedData(domain, types, value)` — is rejected up front with an explanatory error;
 * 3. a wallet matching neither shape gets an error enumerating exactly which members are missing.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import { privateKeyToAccount } from "viem/accounts";

import {
  AbstractWalletError,
  getWalletAddress,
  getWalletChainId,
  signL1Action,
  signUserSignedAction,
} from "@bloxwap/hyperliquid/signing";

// ============================================================
// Test Data
// ============================================================

/** Same key as tests/signing/mod.test.ts, so its pinned signature fixtures apply here too. */
const PRIVATE_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";

/**
 * L1 action fixture from tests/signing/mod.test.ts (base variant, mainnet). The expected
 * signature is an absolute pin: RFC 6979 ECDSA is deterministic, and the typed-data and
 * raw-digest paths hash to the same EIP-712 digest, so every correctly adapted wallet over
 * `PRIVATE_KEY` must reproduce it exactly.
 */
const L1_ACTION = {
  action: {
    type: "order",
    orders: [
      {
        a: 0,
        b: true,
        p: "30000",
        s: "0.1",
        r: false,
        t: { limit: { tif: "Gtc" } },
      },
    ],
    grouping: "na",
  },
  nonce: 1234567890,
  signature: {
    mainnet: {
      r: "0x61078d8ffa3cb591de045438a1ae2ed299b271891d1943a33901e7cfb3a31ed8",
      s: "0x0e91df4f9841641d3322dad8d932874b74d7e082cdb5b533f804964a6963aef9",
      v: 28,
    },
  },
} as const;

/** User-signed action fixture from tests/signing/mod.test.ts, with its pinned signature. */
const USER_SIGNED_ACTION = {
  action: {
    hyperliquidChain: "Mainnet",
    signatureChainId: "0x66eee",
    destination: "0x1234567890123456789012345678901234567890",
    amount: "1000",
    time: 1234567890,
  },
  types: {
    "HyperliquidTransaction:UsdSend": [
      { name: "hyperliquidChain", type: "string" },
      { name: "destination", type: "string" },
      { name: "amount", type: "string" },
      { name: "time", type: "uint64" },
    ],
  },
  signature: {
    r: "0xf777c38efe7c24cc71209526ae608f4e384d0586edf578f0e97b4b9f7c7adcc6",
    s: "0x104a4a97c48ae77bf5bd777bdd45fe72d8f5ff29116b5ff64fd8cfe4ea610786",
    v: 28,
  },
} as const;

/** Well-formed 65-byte hex signature for stubs whose output is never verified. */
const VALID_HEX_SIGNATURE = `0x${"1".repeat(64)}${"2".repeat(64)}1b` as const;

/** Awaits a rejection and returns the caught error (fails if the call resolves). */
async function caught(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected the call to reject");
    },
    (error: unknown) => error as Error,
  );
}

// ============================================================
// Tests
// ============================================================

describe("wallet shape detection (createSigner guards)", () => {
  describe("length-0 wrapped adapters (rest/default parameters)", () => {
    test("rest-args adapter with getAddresses + getChainId adapts as JSON-RPC and signs", async () => {
      const account = privateKeyToAccount(PRIVATE_KEY);
      // A hand-rolled adapter around an embedded-wallet provider: every method forwards through
      // rest args, so each declared `Function.length` is 0 — the shape the old arity guard
      // rejected as "unknown wallet type".
      const adapter = {
        signTypedData: (...args: unknown[]) => account.signTypedData(args[0] as never),
        getAddresses: (..._args: unknown[]) => Promise.resolve([account.address]),
        getChainId: (..._args: unknown[]) => Promise.resolve(0xa4b1),
      };
      assertEquals(adapter.signTypedData.length, 0); // pin the premise: arity is genuinely 0

      // Signs through the public path with the exact fixture signature of the wrapped key.
      const signature = await signL1Action({
        wallet: adapter,
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
      });
      assertEquals(signature, L1_ACTION.signature.mainnet);

      // Classified as JSON-RPC, not local: address and chain ID come from the adapter's methods
      // (a local classification would report the "0x1" fallback chain ID instead).
      assertEquals(await getWalletAddress(adapter), account.address.toLowerCase() as `0x${string}`);
      assertEquals(await getWalletChainId(adapter), "0xa4b1");
    });

    test("all-defaulted-params adapter with a string address adapts as local and signs", async () => {
      const account = privateKeyToAccount(PRIVATE_KEY);
      // Every parameter has a default, so `Function.length` is 0 even though the function
      // consumes a params object — JS counts only parameters before the first default/rest.
      const adapter = {
        address: account.address,
        signTypedData: (params: unknown = undefined, _options: unknown = undefined) =>
          account.signTypedData(params as never),
      };
      assertEquals(adapter.signTypedData.length, 0); // pin the premise: arity is genuinely 0

      const signature = await signUserSignedAction({
        wallet: adapter,
        action: USER_SIGNED_ACTION.action,
        types: USER_SIGNED_ACTION.types,
      });
      assertEquals(signature, USER_SIGNED_ACTION.signature);

      // Classified as local: chain ID is the local fallback, address comes from the property.
      assertEquals(await getWalletChainId(adapter), "0x1");
      assertEquals(await getWalletAddress(adapter), account.address.toLowerCase() as `0x${string}`);
    });
  });

  describe("ethers-style positional signTypedData is rejected up front", () => {
    test("signTypedData(domain, types, value) + address throws before signing", async () => {
      // Membership alone would let this wallet pass the local guard and then fail cryptically at
      // sign time (the whole params object would land in `domain`); 3+ declared parameters is a
      // signature no viem-style wallet has, so it must be rejected with an explanation instead.
      const ethersStyle = {
        address: "0x1111111111111111111111111111111111111111" as const,
        signTypedData: (_domain: unknown, _types: unknown, _value: unknown) => Promise.resolve(VALID_HEX_SIGNATURE),
      };

      // `as never`: the static types already refuse this shape — the guard exists for callers
      // arriving from untyped or loosely typed code, which is what the cast simulates.
      const error = await caught(
        signL1Action({ wallet: ethersStyle as never, action: L1_ACTION.action, nonce: L1_ACTION.nonce }),
      );
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toContain("ethers-style signTypedData(domain, types, value)");
      expect(error.message).toContain("single params object");
    });
  });

  describe("neither guard matches: the error enumerates the missing members", () => {
    test("a wallet without signTypedData enumerates every missing member of both shapes", async () => {
      const error = await caught(getWalletAddress({} as never));
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toContain("no callable signTypedData (found undefined)");
      expect(error.message).toContain(
        "callable getAddresses (found undefined) and callable getChainId (found undefined)",
      );
      expect(error.message).toContain("a string address property (found undefined)");
    });

    test("a wallet lacking only signTypedData is told that alone completes its shape", async () => {
      const wallet = {
        getAddresses: () => Promise.resolve(["0x1111111111111111111111111111111111111111" as const]),
        getChainId: () => Promise.resolve(1),
      };

      const error = await caught(getWalletAddress(wallet as never));
      expect(error).toBeInstanceOf(AbstractWalletError);
      // Both remaining JSON-RPC members are present, so the enumeration must say only
      // signTypedData stands between this wallet and the JSON-RPC shape.
      expect(error.message).toContain("no callable signTypedData");
      expect(error.message).toContain("the JSON-RPC shape is missing nothing else");
    });

    test("signTypedData alone enumerates both missing member sets", async () => {
      const wallet = { signTypedData: () => Promise.resolve(VALID_HEX_SIGNATURE) };

      const error = await caught(
        signL1Action({ wallet: wallet as never, action: L1_ACTION.action, nonce: L1_ACTION.nonce }),
      );
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toContain(
        "callable getAddresses (found undefined) and callable getChainId (found undefined)",
      );
      expect(error.message).toContain("string address property (found undefined)");
    });

    test("a partially JSON-RPC-shaped wallet names only the member it lacks", async () => {
      const wallet = {
        signTypedData: () => Promise.resolve(VALID_HEX_SIGNATURE),
        getAddresses: () => Promise.resolve(["0x1111111111111111111111111111111111111111" as const]),
      };

      const error = await caught(getWalletAddress(wallet as never));
      expect(error).toBeInstanceOf(AbstractWalletError);
      expect(error.message).toContain("missing callable getChainId");
      expect(error.message).not.toContain("missing callable getAddresses");
    });
  });
});
