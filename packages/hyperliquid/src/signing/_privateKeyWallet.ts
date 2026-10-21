/**
 * Raw private key as an {@linkcode AbstractWallet}: the default WASM signer for local keys.
 *
 * {@linkcode createPrivateKeyWallet} turns a 32-byte hex private key — as accepted by
 * `ExchangeSingleWalletConfig.wallet` — into an opaque, frozen carrier object that holds no
 * enumerable key material and is recognized by the wallet adapter through
 * {@linkcode PRIVATE_KEY_SIGNER}. The carried {@linkcode Signer} initializes lazily and exactly
 * once (memoized, deduped): it first tries the optional `tiny-secp256k1` WASM module, validating
 * both its shape and a known-answer signature, and falls back SILENTLY to pure-JS
 * `@noble/curves` when the WASM module is missing or fails the self-check — the user never asked
 * for WASM, they asked for a private key, so there is nothing to warn about. Both backends are
 * RFC 6979 deterministic with low-S normalization, so the signature is byte-identical to viem's;
 * `tests/signing/privateKeyWallet.test.ts` pins that identity across keys, networks, and actions.
 *
 * The dynamic imports are OPAQUE (`import(SPEC)` with a non-literal specifier): the browser build
 * of `tiny-secp256k1` does `import * as wasm from "./secp256k1.wasm"`, which breaks Vite/webpack
 * builds without a WASM plugin when the specifier is statically reachable from `ExchangeClient`.
 * With the opaque form bundlers never follow the import; Node, Bun, and Deno resolve it at
 * runtime, and bundled/browser builds transparently land on the pure-JS fallback. `viem/accounts`
 * gets the same treatment for the `signTypedData` delegation, and because viem is not a
 * dependency of this package at all.
 *
 * `signTypedData` (user-signed actions the hand-rolled digest cannot encode) always delegates to
 * a viem local account created from the same key, imported lazily on first use. A wallet used
 * only for actions the SDK digests itself never loads viem at all.
 * @module
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  type AbstractViemLocalAccount,
  type AbstractWallet,
  AbstractWalletError,
  getWalletAddress as getAbstractWalletAddress,
  getWalletChainId as getAbstractWalletChainId,
  mergeViemTypes,
  PRIVATE_KEY_SIGNER,
  parseSignature,
  type Signature,
  type Signer,
  type TypedDataArgs,
} from "./_abstractWallet.ts";
import { keccak256 } from "./_keccak.ts";

/** The subset of the `tiny-secp256k1` API the WASM backend relies on (validated after import). */
interface TinySecp256k1 {
  isPrivate(d: Uint8Array): boolean;
  pointFromScalar(d: Uint8Array, compressed?: boolean): Uint8Array | null;
  signRecoverable(h: Uint8Array, d: Uint8Array): { signature: Uint8Array; recoveryId: number };
}

/** The subset of the `@noble/curves` secp256k1 API the pure-JS backend relies on. */
interface NobleSecp256k1 {
  getPublicKey(secretKey: Uint8Array, isCompressed?: boolean): Uint8Array;
  sign(
    msgHash: Uint8Array,
    secretKey: Uint8Array,
    options: { prehash: false; lowS: true; format: "recovered" },
  ): Uint8Array;
  utils: { isValidSecretKey(secretKey: Uint8Array): boolean };
}

// ============================================================
// Key format
// ============================================================

/** A 32-byte private key as a hex string: `0x` plus exactly 64 hex digits. */
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Whether `value` is a string at all — the dispatch question `config.wallet` asks. A string that
 * IS given but is not a well-formed 32-byte hex key is a configuration error, not a wallet
 * object, so it throws instead of returning `false` (a malformed key silently treated as a
 * wallet object would fail far from the mistake). The key is never echoed into the message.
 *
 * @throws {AbstractWalletError} If `value` is a string but not a 32-byte hex private key.
 */
export function isPrivateKeyString(value: unknown): value is `0x${string}` {
  if (typeof value !== "string") return false;
  if (!PRIVATE_KEY_PATTERN.test(value)) {
    throw new AbstractWalletError(
      "Invalid private key string: expected a 32-byte hex private key " +
        "(`0x` followed by exactly 64 hexadecimal characters)",
    );
  }
  return true;
}

// ============================================================
// WASM backend (tiny-secp256k1)
// ============================================================

/**
 * Opaque specifier for the optional `tiny-secp256k1` import — see the module docstring for why
 * the specifier must not be a string literal reachable from `ExchangeClient`.
 */
const TINY_SECP256K1_SPEC = "tiny-secp256k1";

/** The real `tiny-secp256k1` import; production calls always take this one. */
function importTinySecp256k1(): Promise<unknown> {
  return import(/* @vite-ignore */ /* webpackIgnore: true */ TINY_SECP256K1_SPEC);
}

/** The loader the WASM backend uses; replaced only by tests through {@linkcode _setPrivateKeyBackendLoaderForTests}. */
let eccLoader: () => Promise<unknown> = importTinySecp256k1;

/**
 * Internal test hook: swaps the `tiny-secp256k1` loader (pass `undefined` to restore the real
 * one), so the fallback arms — absent, broken, or wrong-signing WASM module — can be driven
 * without module mocking (a mocked specifier stays poisoned for the rest of the process; see
 * `_setEccLoaderForTests` in `_fastWallet.ts`). Affects only wallets created afterwards: an
 * initialized wallet keeps its settled backend. Not re-exported from `mod.ts`.
 */
export function _setPrivateKeyBackendLoaderForTests(loader: (() => Promise<unknown>) | undefined): void {
  eccLoader = loader ?? importTinySecp256k1;
}

/**
 * Known-answer self-test the WASM module must pass before it is trusted with real keys: a fixed
 * key signing a fixed digest must reproduce a hard-coded viem signature byte-for-byte. A module
 * with the right shape but a broken or mismatched implementation (wrong curve parameters, a
 * non-deterministic nonce scheme, missing low-S normalization) fails here and routes to the
 * pure-JS fallback, exactly like a missing package.
 */
const KAT_KEY = hexToBytes("822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff");
const KAT_DIGEST = new Uint8Array(32).fill(0x07);
const KAT_EXPECTED =
  "0679e17743b3bc599274a8fac074deaa1eb696b6224984f4142a759d81ee6e6d7065f593377652847b9730aa9e2bc2dfe0e1de8bdbdef9bf6ca9c2ac8ded0cf21b";

/**
 * Loads `tiny-secp256k1` through the current loader and validates it, returning `undefined` on
 * ANY failure: import throws, the three required functions are absent, or the known-answer
 * signature does not match. A `false` `isPrivate` for the user key is NOT handled here — that is
 * an invalid key, not a broken module, and throws rather than falling back.
 */
async function loadWasmBackend(): Promise<TinySecp256k1 | undefined> {
  try {
    const ecc = (await eccLoader()) as TinySecp256k1 | undefined;
    if (
      ecc === undefined ||
      ecc === null ||
      typeof ecc.signRecoverable !== "function" ||
      typeof ecc.pointFromScalar !== "function" ||
      typeof ecc.isPrivate !== "function"
    ) {
      return undefined;
    }
    const { signature, recoveryId } = ecc.signRecoverable(KAT_DIGEST, KAT_KEY);
    if (
      !(signature instanceof Uint8Array) ||
      signature.length !== 64 ||
      bytesToHex(signature) + (27 + (recoveryId & 1)).toString(16) !== KAT_EXPECTED
    ) {
      return undefined;
    }
    return ecc;
  } catch {
    return undefined;
  }
}

// ============================================================
// Pure-JS backend (@noble/curves)
// ============================================================

/**
 * Loads the pure-JS secp256k1 fallback. The specifier is a literal on purpose: `@noble/curves` is
 * a real, unconditional dependency of this package, so every supported consumer can resolve it.
 */
async function loadJsBackend(): Promise<NobleSecp256k1> {
  const { secp256k1 } = (await import("@noble/curves/secp256k1.js")) as { secp256k1: NobleSecp256k1 };
  return secp256k1;
}

// ============================================================
// viem delegation (signTypedData only)
// ============================================================

/**
 * Opaque specifier for the `viem/accounts` import — viem is not a dependency of this package, so
 * the import must not be statically reachable either (every consumer that does not install viem
 * would otherwise fail to resolve this module at load time).
 */
const VIEM_ACCOUNTS_SPEC = "viem/accounts";

/** Resolves viem's `privateKeyToAccount` through the opaque dynamic import. */
async function importPrivateKeyToAccount(): Promise<(privateKey: `0x${string}`) => AbstractViemLocalAccount> {
  try {
    const { privateKeyToAccount } = (await import(/* @vite-ignore */ /* webpackIgnore: true */ VIEM_ACCOUNTS_SPEC)) as {
      privateKeyToAccount: unknown;
    };
    if (typeof privateKeyToAccount !== "function") throw new Error("viem/accounts has no privateKeyToAccount export");
    return privateKeyToAccount as (privateKey: `0x${string}`) => AbstractViemLocalAccount;
  } catch (cause) {
    if (cause instanceof AbstractWalletError) throw cause;
    throw new AbstractWalletError(
      "Signing typed data with a raw private key needs `viem/accounts`, which could not be loaded. " +
        "viem is not a dependency of this package — install it, or pass a viem account " +
        "(`privateKeyToAccount(key)`) as the wallet instead of the raw key. " +
        "See the underlying error on `cause`.",
      { cause },
    );
  }
}

// ============================================================
// Backend
// ============================================================

/** A settled signing backend: the active curve implementation plus the address derived through it. */
interface Backend {
  /** Which curve implementation is active, for {@linkcode _privateKeyWalletBackend}. */
  readonly name: "wasm" | "js";
  /** Lowercase address derived from the key. */
  readonly address: `0x${string}`;
  /** Sign a 32-byte digest, returning the ECDSA components (low-S, `v` = 27/28). */
  readonly sign: (digest: Uint8Array) => Signature;
}

/** Lowercase Ethereum address from an uncompressed 65-byte public key: `keccak256(point[1:])[12:]`. */
function addressFromPoint(point: Uint8Array): `0x${string}` {
  return `0x${bytesToHex(keccak256(point.subarray(1)).subarray(12))}`;
}

/**
 * Builds the WASM backend, throwing (NOT falling back) when the key is outside the secp256k1
 * scalar range: a bad key is a caller bug, and signing it with the other backend would hide it.
 * libsecp256k1 signs RFC 6979 deterministically and normalizes to low-S, flipping the recovery id
 * on normalization — the same output noble produces with `lowS: true`. `v` keeps only the parity
 * bit: the overflow bit (recoveryId 2/3) is unrepresentable in Ethereum's 27/28 scheme.
 */
function wasmBackend(ecc: TinySecp256k1, keyBytes: Uint8Array): Backend {
  if (!ecc.isPrivate(keyBytes)) {
    throw new AbstractWalletError("Private key is outside the secp256k1 scalar range");
  }
  const point = ecc.pointFromScalar(keyBytes, false);
  if (point === null || point.length !== 65) {
    throw new AbstractWalletError("Failed to derive the public key from the private key");
  }
  return {
    name: "wasm",
    address: addressFromPoint(point),
    sign: (digest: Uint8Array): Signature => {
      const { signature, recoveryId } = ecc.signRecoverable(digest, keyBytes);
      return {
        r: `0x${bytesToHex(signature.subarray(0, 32))}`,
        s: `0x${bytesToHex(signature.subarray(32, 64))}`,
        v: (27 + (recoveryId & 1)) as 27 | 28,
      };
    },
  };
}

/**
 * Builds the pure-JS backend on `@noble/curves`. `sign` with `format: "recovered"` returns
 * `[recovery, r(32), s(32)]`; `lowS: true` matches libsecp256k1's normalization, so the output is
 * byte-identical to the WASM backend and to viem.
 */
function jsBackend(secp256k1: NobleSecp256k1, keyBytes: Uint8Array): Backend {
  if (!secp256k1.utils.isValidSecretKey(keyBytes)) {
    throw new AbstractWalletError("Private key is outside the secp256k1 scalar range");
  }
  return {
    name: "js",
    address: addressFromPoint(secp256k1.getPublicKey(keyBytes, false)),
    sign: (digest: Uint8Array): Signature => {
      const recovered = secp256k1.sign(digest, keyBytes, { prehash: false, lowS: true, format: "recovered" });
      return {
        r: `0x${bytesToHex(recovered.subarray(1, 33))}`,
        s: `0x${bytesToHex(recovered.subarray(33, 65))}`,
        v: (27 + (recovered[0] & 1)) as 27 | 28,
      };
    },
  };
}

// ============================================================
// Wallet
// ============================================================

/**
 * Module-local key for the carrier's initializer, so the internal hooks below can trigger and
 * inspect initialization without the key material ever becoming an own property of the carrier.
 */
const INIT: unique symbol = Symbol("hyperliquid.privateKeyInit");

interface PrivateKeyCarrier {
  [PRIVATE_KEY_SIGNER]: Signer;
  [INIT]: () => Promise<Backend>;
}

/** The carrier as a readonly view for the internal hooks. */
function asCarrier(wallet: AbstractWallet): PrivateKeyCarrier | undefined {
  const carrier = wallet as Partial<PrivateKeyCarrier>;
  return typeof carrier[INIT] === "function" ? (carrier as PrivateKeyCarrier) : undefined;
}

/**
 * Creates an {@linkcode AbstractWallet} from a raw 32-byte hex private key — synchronously. The
 * returned carrier is frozen, carries no enumerable key material (the key lives in closures
 * behind symbols), and adapts to a {@linkcode Signer} of kind `"local-key"` through
 * {@linkcode PRIVATE_KEY_SIGNER}.
 *
 * Curve initialization (WASM attempt, self-check, possible pure-JS fallback, public-key
 * derivation) is lazy: it starts on the first signing or address call, or on
 * {@linkcode preloadPrivateKeyWallet}, and is memoized so concurrent first calls share it. A
 * well-formed key outside the secp256k1 scalar range therefore surfaces as a rejection on the
 * first signing call, while a malformed string throws here, synchronously.
 *
 * Package-internal — not re-exported from `mod.ts`. The public entry point is passing the key
 * string as `ExchangeSingleWalletConfig.wallet`.
 *
 * @param privateKey The 32-byte private key as a hex string.
 * @return The carrier wallet.
 *
 * @throws {AbstractWalletError} If the string is not a 32-byte hex private key.
 */
export function createPrivateKeyWallet(privateKey: `0x${string}`): AbstractWallet {
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new AbstractWalletError(
      "Invalid private key string: expected a 32-byte hex private key " +
        "(`0x` followed by exactly 64 hexadecimal characters)",
    );
  }
  const keyBytes = hexToBytes(privateKey.slice(2));

  // The one initialization attempt, memoized. A rejected promise stays memoized: a transient
  // loader failure has already fallen back, so the only rejection left is an invalid key, which
  // must surface identically on every signing call rather than be retried into a different error.
  let initPromise: Promise<Backend> | undefined;
  const init = (): Promise<Backend> => {
    initPromise ??= (async (): Promise<Backend> => {
      const ecc = await loadWasmBackend();
      if (ecc !== undefined) return wasmBackend(ecc, keyBytes);
      return jsBackend(await loadJsBackend(), keyBytes);
    })();
    return initPromise;
  };

  // viem is needed only for `signTypedData` (the user-signed actions the hand-rolled digest
  // cannot encode); a wallet used only for SDK-digested actions never pays for the import.
  let viemAccount: AbstractViemLocalAccount | undefined;
  const viemDelegate = async (): Promise<AbstractViemLocalAccount> => {
    if (viemAccount === undefined) {
      const privateKeyToAccount = await importPrivateKeyToAccount();
      viemAccount = privateKeyToAccount(privateKey);
    }
    return viemAccount;
  };

  const signer: Signer = {
    kind: "local-key",
    async signDigest(digest: Uint8Array): Promise<Signature> {
      return (await init()).sign(digest);
    },
    async signTypedData(args: TypedDataArgs): Promise<Signature> {
      // Reached only when the SDK's hand-rolled digest cannot encode the action; sign exactly as
      // `adaptViemLocal` would (merged EIP712Domain type, parsed 65-byte signature).
      const account = await viemDelegate();
      const hex = await account.signTypedData({
        domain: args.domain,
        types: mergeViemTypes(args.types),
        primaryType: args.primaryType,
        message: args.message,
      });
      return parseSignature(hex);
    },
    async getAddress(): Promise<`0x${string}`> {
      return (await init()).address;
    },
    getChainId(): Promise<`0x${string}`> {
      // Local keys have no notion of chain; default to "0x1", like a viem local account.
      return Promise.resolve("0x1");
    },
  };

  return Object.freeze({ [PRIVATE_KEY_SIGNER]: signer, [INIT]: init }) as unknown as AbstractWallet;
}

/**
 * Triggers the carrier's one-time initialization without signing, so the WASM load and self-check
 * run during start-up rather than on the first order. Resolves when initialization has settled;
 * rejects when the key is outside the secp256k1 scalar range (the same failure the first signing
 * call would hit). A no-op for wallets that are not private-key carriers.
 *
 * Package-internal — not re-exported from `mod.ts`.
 */
export function preloadPrivateKeyWallet(wallet: AbstractWallet): Promise<void> {
  const carrier = asCarrier(wallet);
  if (carrier === undefined) return Promise.resolve();
  return carrier[INIT]().then(() => undefined);
}

/**
 * Internal test hook: resolves to the backend the carrier settled on (`"wasm"` or `"js"`).
 * Not re-exported from `mod.ts`.
 *
 * @throws {AbstractWalletError} If `wallet` is not a private-key carrier.
 */
export function _privateKeyWalletBackend(wallet: AbstractWallet): Promise<"wasm" | "js"> {
  const carrier = asCarrier(wallet);
  if (carrier === undefined) {
    throw new AbstractWalletError("Not a private-key wallet carrier");
  }
  return carrier[INIT]().then((backend) => backend.name);
}

// ============================================================
// Identity helpers accepting a key string
// ============================================================

/**
 * Gets the lowercase wallet address from various wallet types, or from a raw 32-byte hex private
 * key (the other form `ExchangeSingleWalletConfig.wallet` accepts, so
 * `getWalletAddress(client.config.wallet)` keeps working for either).
 *
 * Concurrent calls for the same wallet share a single lookup. For a local account the resolved
 * address is reused thereafter; for a JSON-RPC wallet it is re-read on the next call, because the
 * user may have switched accounts in the meantime. A key string is derived on each call.
 *
 * @param wallet The wallet to query, or a raw private key string.
 * @return The lowercase wallet address as a hex string.
 *
 * @throws {AbstractWalletError} If getting the address fails, the wallet type is unknown, or a
 * key string is malformed.
 */
export function getWalletAddress(wallet: AbstractWallet | `0x${string}`): Promise<`0x${string}`> {
  if (typeof wallet !== "string") return getAbstractWalletAddress(wallet);
  try {
    return getAbstractWalletAddress(createPrivateKeyWallet(wallet));
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Gets the chain ID of the wallet, or `"0x1"` for a raw private key string (a local key has no
 * notion of chain, exactly like a viem local account).
 *
 * Concurrent calls for the same wallet share a single lookup. For a local account the answer is a
 * constant and is reused; for a JSON-RPC wallet it is re-read on the next call, because the user may
 * have switched networks.
 *
 * @param wallet The wallet to query, or a raw private key string.
 * @return The chain ID as a hex string.
 *
 * @throws {AbstractWalletError} If getting the chain ID fails, the wallet type is unknown, or a
 * key string is malformed.
 */
export function getWalletChainId(wallet: AbstractWallet | `0x${string}`): Promise<`0x${string}`> {
  if (typeof wallet !== "string") return getAbstractWalletChainId(wallet);
  try {
    return getAbstractWalletChainId(createPrivateKeyWallet(wallet));
  } catch (error) {
    return Promise.reject(error);
  }
}
