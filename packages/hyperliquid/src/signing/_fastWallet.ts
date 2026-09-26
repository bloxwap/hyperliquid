/**
 * Opt-in WASM-accelerated local wallet.
 *
 * {@linkcode createFastLocalWallet} builds an {@linkcode AbstractViemLocalAccount} whose raw-digest
 * `sign({ hash })` — the capability the L1 signing path uses via `signRawDigest` — runs on
 * `tiny-secp256k1` (WASM libsecp256k1) instead of viem's pure-JS noble secp256k1, cutting the
 * ECDSA cost roughly in half (~56 µs vs ~85 µs per signature). Both signers are RFC 6979
 * deterministic with low-S normalization, so the WASM signature is byte-identical to the
 * noble/viem one; `tests/signing/fastWallet.test.ts` pins that identity across keys, networks,
 * and actions.
 *
 * The acceleration is strictly opt-in and lazy: `tiny-secp256k1` is an optional dependency loaded
 * through a guarded dynamic import inside the factory, so users who never call it never load the
 * WASM module. If the package is missing or fails to initialize, the factory warns once and
 * returns the plain viem account — signing keeps working through the noble path.
 *
 * `signTypedData` (user-signed actions, multi-sig wrappers) is not accelerated: it delegates to a
 * viem local account created from the same key, imported lazily on first use. A wallet used only
 * for L1 actions therefore never loads viem at all.
 *
 * viem is not a dependency of this package, so both viem-dependent paths reach it through
 * `import()`. Environments that cannot service a dynamic import (Jest without
 * `--experimental-vm-modules`, some React Native bundlers) supply `options.privateKeyToAccount`
 * instead; without it those paths throw an error saying so.
 * @module
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  type AbstractViemLocalAccount,
  AbstractWalletError,
  type DigestBytesCapable,
  SIGN_DIGEST_BYTES,
} from "./_abstractWallet.ts";

/** The subset of the `tiny-secp256k1` API the fast wallet relies on (validated after import). */
interface TinySecp256k1 {
  isPrivate(d: Uint8Array): boolean;
  pointFromScalar(d: Uint8Array, compressed?: boolean): Uint8Array | null;
  signRecoverable(h: Uint8Array, d: Uint8Array): { signature: Uint8Array; recoveryId: number };
}

/** Guards the one-time fallback warning so a burst of factory calls logs exactly once. */
let fallbackWarningShown = false;

/**
 * Dynamically imports `tiny-secp256k1`, returning `undefined` when the optional dependency is
 * missing or unusable. The shape check guards against a partially linked install the same way the
 * `try` guards against an absent one: both route to the viem/noble fallback.
 *
 * Exported (never from `mod.ts`) so tests can drive the failure arms through the same code the
 * real path uses: ESM module records are immutable, so a rejecting or partially linked real
 * import cannot be simulated any other way — see {@linkcode _setEccLoaderForTests} for why module
 * mocking is not an option. Production calls always take the default real import.
 */
export async function loadTinySecp256k1(
  importEcc: () => Promise<unknown> = () => import("tiny-secp256k1"),
): Promise<TinySecp256k1 | undefined> {
  try {
    const ecc = (await importEcc()) as TinySecp256k1;
    if (
      typeof ecc.signRecoverable !== "function" ||
      typeof ecc.pointFromScalar !== "function" ||
      typeof ecc.isPrivate !== "function"
    ) {
      return undefined;
    }
    return ecc;
  } catch {
    return undefined;
  }
}

/** The loader the factory uses; replaced only by tests through {@linkcode _setEccLoaderForTests}. */
let eccLoader: () => Promise<TinySecp256k1 | undefined> = loadTinySecp256k1;

/** `privateKeyToAccount` from `viem/accounts`, however the caller obtained it. */
export type PrivateKeyToAccount = (privateKey: `0x${string}`) => AbstractViemLocalAccount;

/**
 * Resolves `privateKeyToAccount`, preferring one the caller supplied.
 *
 * `viem` is not a dependency of this package — not even an optional one — so it can only be
 * reached through `import()`, and the specifier has to stay dynamic or every consumer who does not
 * use viem would fail to resolve this module at load time. Some environments cannot service a
 * dynamic import at all: Jest without `--experimental-vm-modules` rejects it with "A dynamic
 * import callback was invoked without --experimental-vm-modules", and bundlers targeting React
 * Native may drop it. Those callers pass `privateKeyToAccount` in and never reach the import.
 *
 * When neither is possible the failure is reported for what it is, rather than surfacing the
 * host's opaque message from somewhere deep in the signing path.
 */
async function resolvePrivateKeyToAccount(
  provided: PrivateKeyToAccount | undefined,
  need: "the tiny-secp256k1 fallback" | "signTypedData",
): Promise<PrivateKeyToAccount> {
  if (provided !== undefined) return provided;
  try {
    const { privateKeyToAccount } = await import("viem/accounts");
    return privateKeyToAccount as PrivateKeyToAccount;
  } catch (cause) {
    // Two very different situations land here and the remedy differs, so name both rather than
    // asserting one: viem may be absent (it is not a dependency, so this is the common case), or
    // present but unreachable because the host cannot service a dynamic import.
    throw new AbstractWalletError(
      `createFastLocalWallet: ${need} needs \`viem/accounts\`, which could not be loaded. ` +
        "Either viem is not installed (it is not a dependency of this package — install it), or " +
        "this environment cannot service the dynamic import used to reach it (Jest without " +
        "`--experimental-vm-modules` is the usual cause), in which case import " +
        "`privateKeyToAccount` from `viem/accounts` yourself and pass it as " +
        "`options.privateKeyToAccount`. See the underlying error on `cause`.",
      { cause },
    );
  }
}

/**
 * Guards against a supplied factory that ignores the key it is handed.
 *
 * The natural mistake in exactly the hosts `options.privateKeyToAccount` exists for is passing a
 * bound or curried helper closed over a different key — `() => myAccount` type-checks. On the WASM
 * path the wallet's `address` and raw-digest signer come from `tiny-secp256k1` over `privateKey`
 * while `signTypedData` delegates to this factory, so a mismatch would sign L1 actions and
 * user-signed actions with two different keys and report only one of them.
 */
function assertDelegateMatches(delegate: AbstractViemLocalAccount, expected: `0x${string}`): void {
  if (delegate.address?.toLowerCase() !== expected.toLowerCase()) {
    throw new AbstractWalletError(
      `createFastLocalWallet: options.privateKeyToAccount returned an account for ${delegate.address}, ` +
        `but this wallet signs as ${expected}. It must derive the account from the private key it is given.`,
    );
  }
}

/**
 * Internal test hook: swaps the `tiny-secp256k1` loader (pass `undefined` to restore the real one)
 * and resets the one-time warning latch. Module mocking cannot reliably simulate a missing
 * dependency — a mocked specifier stays poisoned for the rest of the process and a previously
 * loaded real module shadows the mock, so which path a test sees would depend on file order. Not
 * re-exported from `mod.ts`; the public surface is {@linkcode createFastLocalWallet} only.
 */
export function _setEccLoaderForTests(loader: (() => Promise<TinySecp256k1 | undefined>) | undefined): void {
  eccLoader = loader ?? loadTinySecp256k1;
  fallbackWarningShown = false;
}

/** Derives the Ethereum address from a private key via the WASM module (`keccak256(uncompressedPoint[1:])[12:]`). */
function deriveAddress(ecc: TinySecp256k1, privateKeyBytes: Uint8Array): `0x${string}` {
  const point = ecc.pointFromScalar(privateKeyBytes, false);
  if (point === null || point.length !== 65) {
    throw new AbstractWalletError("Failed to derive the public key from the private key");
  }
  return toChecksumAddress(`0x${bytesToHex(keccak_256(point.subarray(1)).subarray(12))}`);
}

/** Shared encoder for the EIP-55 checksum preimage. */
const ENCODER = new TextEncoder();

/** EIP-55 checksum casing, so the wallet's `address` is byte-identical to viem's `privateKeyToAccount`. */
function toChecksumAddress(address: `0x${string}`): `0x${string}` {
  const lower = address.slice(2);
  const hash = bytesToHex(keccak_256(ENCODER.encode(lower)));
  let checksummed = "";
  for (let i = 0; i < lower.length; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return `0x${checksummed}`;
}

/**
 * Creates a local wallet from a private key, accelerating raw-digest signing with the optional
 * `tiny-secp256k1` WASM module when it is available.
 *
 * The returned wallet satisfies {@linkcode AbstractViemLocalAccount} and is accepted anywhere the
 * SDK takes a wallet. With the WASM module loaded, `sign({ hash })` produces a signature
 * byte-identical to viem's (RFC 6979 nonce, low-S normalized, `v` = 27/28) at roughly half the
 * CPU cost, which is what `signL1Action` pays per L1 action.
 *
 * Fallbacks, in order:
 * - `tiny-secp256k1` missing or broken → a one-time `console.warn`, and the factory returns the
 *   plain viem local account (the noble path).
 * - `signTypedData` → always delegated to viem (imported lazily on first use), since the WASM
 *   module accelerates raw digests only.
 *
 * Both fallbacks need `viem/accounts`, which this package can only reach through a dynamic import
 * (viem is not a dependency of it). Environments that cannot service one — Jest without
 * `--experimental-vm-modules`, some React Native bundlers — must pass `options.privateKeyToAccount`;
 * otherwise those two paths throw with an explanation. With `tiny-secp256k1` present and only L1
 * actions signed, viem is never needed at all.
 *
 * @param privateKey The 32-byte private key as a hex string.
 * @param options Set `wasm: false` to skip the WASM accelerator and use the viem/noble path directly,
 * and `privateKeyToAccount` to supply viem's factory where a dynamic import is unavailable.
 * @return The wallet, WASM-accelerated when available.
 *
 * @throws {AbstractWalletError} If the private key is not a valid 32-byte secp256k1 scalar, or if
 * viem is needed but can neither be imported nor was supplied.
 *
 * @example
 * ```ts
 * import { createFastLocalWallet, signL1Action } from "@bloxwap/hyperliquid/signing";
 *
 * const wallet = await createFastLocalWallet("0x...");
 *
 * const action = { type: "cancel", cancels: [{ a: 0, o: 12345 }] };
 * const signature = await signL1Action({ wallet, action, nonce: Date.now() });
 * ```
 */
export async function createFastLocalWallet(
  privateKey: `0x${string}`,
  options?: {
    /** Set `false` to skip the WASM accelerator and use the viem/noble path. Default: `true`. */
    wasm?: boolean;
    /**
     * `privateKeyToAccount` from `viem/accounts`, for environments where this package cannot
     * `import()` it (Jest without `--experimental-vm-modules`, some React Native bundlers). When
     * supplied it is used instead of the dynamic import on both viem-dependent paths: the
     * `tiny-secp256k1` fallback and `signTypedData`.
     */
    privateKeyToAccount?: PrivateKeyToAccount;
  },
): Promise<AbstractViemLocalAccount> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new AbstractWalletError("Expected a 32-byte hex private key");
  }
  const privateKeyBytes = hexToBytes(privateKey.slice(2));

  const ecc = options?.wasm === false ? undefined : await eccLoader();
  if (ecc === undefined) {
    if (options?.wasm !== false && !fallbackWarningShown) {
      fallbackWarningShown = true;
      console.warn(
        "createFastLocalWallet: the optional dependency `tiny-secp256k1` could not be loaded; " +
          "falling back to the viem/noble signing path. Install `tiny-secp256k1` to enable WASM acceleration.",
      );
    }
    const privateKeyToAccount = await resolvePrivateKeyToAccount(
      options?.privateKeyToAccount,
      "the tiny-secp256k1 fallback",
    );
    return privateKeyToAccount(privateKey);
  }

  if (!ecc.isPrivate(privateKeyBytes)) {
    throw new AbstractWalletError("Private key is outside the secp256k1 scalar range");
  }

  // Derived once, and also the identity any `signTypedData` delegate must agree with.
  const address = deriveAddress(ecc, privateKeyBytes);

  // viem is needed only for `signTypedData` (user-signed actions); a pure-L1 wallet never pays for it.
  let delegate: AbstractViemLocalAccount | undefined;
  const viemDelegate = async (): Promise<AbstractViemLocalAccount> => {
    if (delegate === undefined) {
      const privateKeyToAccount = await resolvePrivateKeyToAccount(options?.privateKeyToAccount, "signTypedData");
      const resolved = privateKeyToAccount(privateKey);
      // The WASM path derives `address` and the digest signer itself, so a delegate for a
      // different key would split this wallet's identity in two. Checked before it is memoized.
      assertDelegateMatches(resolved, address);
      delegate = resolved;
    }
    return delegate;
  };

  // libsecp256k1 signs RFC 6979 deterministically and normalizes to low-S, flipping the
  // recovery id on normalization — the same output noble produces with `lowS: true`, so the
  // 65-byte layout is byte-identical to viem's `sign`. `v` keeps only the parity bit: the
  // overflow bit (recoveryId 2/3) is unrepresentable in Ethereum's 27/28 scheme.
  const signDigestBytes = (digest: Uint8Array): `0x${string}` => {
    const { signature, recoveryId } = ecc.signRecoverable(digest, privateKeyBytes);
    return `0x${bytesToHex(signature)}${(27 + (recoveryId & 1)).toString(16)}`;
  };

  const account: AbstractViemLocalAccount & DigestBytesCapable = {
    address,
    async sign({ hash }: { hash: `0x${string}` }): Promise<`0x${string}`> {
      return signDigestBytes(hexToBytes(hash.slice(2)));
    },
    // Bytes-level capability the L1 path prefers over hex `sign` (see SIGN_DIGEST_BYTES).
    [SIGN_DIGEST_BYTES]: async (digest: Uint8Array): Promise<`0x${string}`> => signDigestBytes(digest),
    async signTypedData(params: never, _options?: unknown): Promise<`0x${string}`> {
      return (await viemDelegate()).signTypedData(params);
    },
  };
  return account;
}
