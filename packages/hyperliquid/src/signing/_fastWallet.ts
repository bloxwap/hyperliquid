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
 * through an opaque dynamic import (`import(SPEC)`, not a string literal, with `webpackIgnore` /
 * `@vite-ignore`) inside the factory, so users who never call it never load the WASM module and
 * bundlers of `ExchangeClient` never follow the import. The browser build of the package imports
 * a `.wasm` file, which breaks esbuild, Vite, and webpack without a WASM plugin. Node, Bun, and
 * Deno still resolve the specifier at runtime. The module must pass the same known-answer
 * self-check as the raw-key wallet before it is trusted; the check is cached for the life of the
 * loader. If the package is missing, fails to initialize, or fails that check, the factory warns
 * once and returns the plain viem account — signing keeps working through the noble path.
 *
 * `signTypedData` (user-signed actions, multi-sig wrappers) is not accelerated: it delegates to a
 * viem local account created from the same key, imported lazily on first use through the same
 * opaque-specifier pattern (`viem` is not a dependency of this package). A wallet used only for
 * L1 actions therefore never loads viem at all.
 *
 * Environments that cannot service a dynamic import (Jest without `--experimental-vm-modules`,
 * some React Native bundlers) supply `options.privateKeyToAccount` instead; without it those
 * paths throw an error saying so.
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
import { acceptTinySecp256k1, type TinySecp256k1 } from "./_secp256k1SelfCheck.ts";

/** Guards the one-time fallback warning so a burst of factory calls logs exactly once. */
let fallbackWarningShown = false;

/**
 * Opaque specifier for the optional `tiny-secp256k1` import. A string literal here is statically
 * reachable from `ExchangeClient` and makes esbuild pull in `secp256k1.wasm`. See the module
 * docstring.
 */
const TINY_SECP256K1_SPEC = "tiny-secp256k1";

/** The real `tiny-secp256k1` import; production calls always take this one. */
function importTinySecp256k1(): Promise<unknown> {
  return import(/* @vite-ignore */ /* webpackIgnore: true */ TINY_SECP256K1_SPEC);
}

/**
 * Dynamically imports `tiny-secp256k1` and accepts it only after the shared known-answer
 * self-check, returning `undefined` when the optional dependency is missing or unusable. The
 * shape check and the self-check both route to the viem/noble fallback, the same way a thrown
 * import does.
 *
 * Exported (never from `mod.ts`) so tests can drive the failure arms through the same code the
 * real path uses: ESM module records are immutable, so a rejecting or partially linked real
 * import cannot be simulated any other way — see {@linkcode _setEccLoaderForTests} for why module
 * mocking is not an option. Production calls always take the default real import.
 */
export async function loadTinySecp256k1(
  importEcc: () => Promise<unknown> = importTinySecp256k1,
): Promise<TinySecp256k1 | undefined> {
  try {
    return acceptTinySecp256k1(await importEcc());
  } catch {
    return undefined;
  }
}

/** The loader the factory uses; replaced only by tests through {@linkcode _setEccLoaderForTests}. */
let eccLoader: () => Promise<unknown> = loadTinySecp256k1;

/**
 * One validation per loader. The self-check signs a fixed digest, so repeating it on every
 * `createFastLocalWallet` call would put that signature on wallet construction. Production uses
 * {@linkcode loadTinySecp256k1} for the life of the process; a test loader is cached until
 * {@linkcode _setEccLoaderForTests} replaces it.
 */
let validatedLoader: (() => Promise<unknown>) | undefined;
let validatedEcc: Promise<TinySecp256k1 | undefined> | undefined;

/** Loads and validates the current loader, reusing the result while the loader is unchanged. */
function resolveEcc(): Promise<TinySecp256k1 | undefined> {
  if (validatedLoader === eccLoader && validatedEcc !== undefined) return validatedEcc;
  const loader = eccLoader;
  validatedLoader = loader;
  // The default loader already runs the self-check. A test loader returns a raw module, so the
  // check has to happen here or a wrong-answer module would be trusted.
  validatedEcc =
    loader === loadTinySecp256k1
      ? loadTinySecp256k1()
      : Promise.resolve()
          .then(() => loader())
          .then((value) => acceptTinySecp256k1(value))
          .catch(() => undefined);
  return validatedEcc;
}

/** `privateKeyToAccount` from `viem/accounts`, however the caller obtained it. */
export type PrivateKeyToAccount = (privateKey: `0x${string}`) => AbstractViemLocalAccount;

/**
 * Opaque specifier for `viem/accounts`. viem is not a dependency of this package, so a literal
 * import of it would fail every consumer bundle that does not install it.
 */
const VIEM_ACCOUNTS_SPEC = "viem/accounts";

/** The real `viem/accounts` import; production calls always take this one. */
function importViemAccounts(): Promise<{ privateKeyToAccount: unknown }> {
  return import(/* @vite-ignore */ /* webpackIgnore: true */ VIEM_ACCOUNTS_SPEC);
}

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
 *
 * Exported (never from `mod.ts`) for the same reason as {@linkcode loadTinySecp256k1}: a failing
 * real import can only be driven through the `importViem` parameter. Production calls always take
 * the default real import.
 */
export async function resolvePrivateKeyToAccount(
  provided: PrivateKeyToAccount | undefined,
  need: "the tiny-secp256k1 fallback" | "signTypedData",
  importViem: () => Promise<{ privateKeyToAccount: unknown }> = importViemAccounts,
): Promise<PrivateKeyToAccount> {
  if (provided !== undefined) return provided;
  try {
    const { privateKeyToAccount } = await importViem();
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
export function _setEccLoaderForTests(loader: (() => Promise<unknown>) | undefined): void {
  eccLoader = loader ?? loadTinySecp256k1;
  fallbackWarningShown = false;
  validatedLoader = undefined;
  validatedEcc = undefined;
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
 * - `tiny-secp256k1` missing, broken, or failing its known-answer self-check → a one-time
 *   `console.warn`, and the factory returns the plain viem local account (the noble path).
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

  const ecc = options?.wasm === false ? undefined : await resolveEcc();
  if (ecc === undefined) {
    if (options?.wasm !== false && !fallbackWarningShown) {
      fallbackWarningShown = true;
      console.warn(
        "createFastLocalWallet: the optional dependency `tiny-secp256k1` could not be loaded or failed its " +
          "self-check; falling back to the viem/noble signing path. Install `tiny-secp256k1` to enable WASM " +
          "acceleration.",
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
  // 65-byte layout is byte-identical to viem's `sign`. A module that passed the known-answer
  // check can still return a short buffer or a recovery id outside {0, 1} for some other digest.
  // Those are not Ethereum signatures (`v` is only 27/28); sending them would authorize nothing
  // and point nowhere. `(recoveryId & ~1) === 0` is the overflow-bit check, and the strict
  // `0`/`1` test rejects values whose ToInt32 coercion would otherwise pass the mask.
  const signDigestBytes = (digest: Uint8Array): `0x${string}` => {
    const { signature, recoveryId } = ecc.signRecoverable(digest, privateKeyBytes);
    if (
      !(signature instanceof Uint8Array) ||
      signature.length !== 64 ||
      (recoveryId !== 0 && recoveryId !== 1) ||
      (recoveryId & ~1) !== 0
    ) {
      throw new AbstractWalletError(
        "tiny-secp256k1 returned a signature that cannot be recovered (expected 64 bytes and recovery id 0 or 1)",
      );
    }
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
