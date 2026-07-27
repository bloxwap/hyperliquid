/**
 * Abstract wallet interfaces and signing utilities for [EIP-712](https://eips.ethereum.org/EIPS/eip-712) typed data.
 * @module
 */

import { HyperliquidError } from "../_base.ts";

// ============================================================
// Error
// ============================================================

/** Thrown when an error occurs in AbstractWallet operations (e.g., signing, getting address). */
export class AbstractWalletError extends HyperliquidError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AbstractWalletError";
  }
}

// ============================================================
// Signer Adapter Infrastructure
// ============================================================

/** Common domain type for EIP-712 typed data signing. */
interface TypedDataDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}

/** Common types structure for EIP-712 typed data. */
interface TypedDataTypes {
  [key: string]: readonly { name: string; type: string }[];
}

/** Arguments passed to {@link Signer.signTypedData}. */
interface TypedDataArgs {
  domain: TypedDataDomain;
  types: TypedDataTypes;
  primaryType: string;
  message: Record<string, unknown>;
}

/** ECDSA signature components. */
export interface Signature {
  /** First 32-byte component of ECDSA signature. */
  r: `0x${string}`;
  /** Second 32-byte component of ECDSA signature. */
  s: `0x${string}`;
  /** Recovery identifier. */
  v: 27 | 28;
}

/** Uniform interface produced by adapting any {@link AbstractWallet}. */
interface Signer {
  /** Wallet kind label, used in error messages. */
  readonly kind: "viem-local" | "viem-jsonrpc";
  /** Sign EIP-712 typed data and return the parsed signature. */
  signTypedData(args: TypedDataArgs): Promise<Signature>;
  /**
   * Sign a raw 32-byte digest directly, skipping EIP-712 encoding entirely. Present only when the
   * wallet can do so locally (viem local accounts expose `sign`); JSON-RPC wallets never have it,
   * so their behavior is unchanged.
   */
  signDigest?(digest: `0x${string}`): Promise<Signature>;
  /** Lowercase wallet address. */
  getAddress(): Promise<`0x${string}`>;
  /** Wallet chain ID as a hex string. */
  getChainId(): Promise<`0x${string}`>;
}

/** Parse a 65-byte hex signature into `{r, s, v}`. Normalizes raw recovery 0/1 to 27/28. */
function parseSignature(hex: `0x${string}`): Signature {
  if (hex.length !== 132) {
    throw new AbstractWalletError(`Expected 65-byte signature (132 hex chars), got ${hex.length}`);
  }
  const r = `0x${hex.slice(2, 66)}` as `0x${string}`;
  const s = `0x${hex.slice(66, 130)}` as `0x${string}`;
  let v = parseInt(hex.slice(130, 132), 16);
  if (v === 0 || v === 1) v += 27;
  if (v !== 27 && v !== 28) {
    throw new AbstractWalletError(`Invalid signature recovery value: ${v}, expected 0/1 or 27/28`);
  }
  return { r, s, v };
}

// ============================================================
// Viem JSON-RPC Account
// ============================================================

/** EIP-712 domain type definition; viem wallet adapters require it in `types`. */
const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

/** Cache of viem `types` objects merged with `EIP712Domain` (keyed by the original `types` object identity). */
const viemTypesCache = new WeakMap<TypedDataTypes, TypedDataTypes>();

/** Merges `EIP712Domain` into `types` for viem wallets (memoized per `types` object). */
function mergeViemTypes(types: TypedDataTypes): TypedDataTypes {
  let merged = viemTypesCache.get(types);
  if (merged === undefined) {
    merged = { EIP712Domain: EIP712_DOMAIN_TYPE, ...types };
    viemTypesCache.set(types, merged);
  }
  return merged;
}

/** Viem-style typed data parameters. */
interface ViemTypedDataParams {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: TypedDataTypes;
  primaryType: string;
  message: Record<string, unknown>;
}

/** Abstract interface for a {@link https://viem.sh/docs/accounts/jsonRpc#json-rpc-account | viem JSON-RPC Account}. */
export interface AbstractViemJsonRpcAccount {
  /**
   * `options` is not in {@link https://viem.sh/docs/actions/wallet/signTypedData | base viem};
   * accepted for wallet extensions like {@link https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data | Privy}.
   */
  signTypedData(params: ViemTypedDataParams, options?: unknown): Promise<`0x${string}`>;
  getAddresses(): Promise<`0x${string}`[]>;
  getChainId(): Promise<number>;
}

function isViemJsonRpc(wallet: AbstractWallet): wallet is AbstractViemJsonRpcAccount {
  return (
    "signTypedData" in wallet &&
    typeof wallet.signTypedData === "function" &&
    (wallet.signTypedData.length === 1 || wallet.signTypedData.length === 2) &&
    "getAddresses" in wallet &&
    typeof wallet.getAddresses === "function" &&
    "getChainId" in wallet &&
    typeof wallet.getChainId === "function"
  );
}

function adaptViemJsonRpc(wallet: AbstractViemJsonRpcAccount): Signer {
  return {
    kind: "viem-jsonrpc",
    async signTypedData(args: TypedDataArgs): Promise<Signature> {
      const hex = await wallet.signTypedData({
        domain: args.domain,
        types: mergeViemTypes(args.types),
        primaryType: args.primaryType,
        message: args.message,
      });
      return parseSignature(hex);
    },
    async getAddress(): Promise<`0x${string}`> {
      const addresses = await wallet.getAddresses();
      if (!addresses.length) throw new AbstractWalletError("Wallet returned no addresses");
      return addresses[0].toLowerCase() as `0x${string}`;
    },
    async getChainId(): Promise<`0x${string}`> {
      const id = await wallet.getChainId();
      return `0x${id.toString(16)}`;
    },
  };
}

// ============================================================
// Viem Local Account
// ============================================================

/** Abstract interface for a {@link https://viem.sh/docs/accounts/local | viem Local Account}. */
export interface AbstractViemLocalAccount {
  /**
   * `options` is not in {@link https://viem.sh/docs/actions/wallet/signTypedData | base viem};
   * accepted for wallet extensions like {@link https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data | Privy}.
   */
  signTypedData(params: ViemTypedDataParams, options?: unknown): Promise<`0x${string}`>;
  /**
   * Optional raw-digest signing, matching {@link https://viem.sh/docs/accounts/local#sign-optional | viem's
   * `LocalAccount.sign`}. When present, L1 action signing uses it to sign the action's EIP-712 digest
   * directly — skipping the generic typed-data encoding — while producing a byte-identical signature.
   * Wallets without it (or JSON-RPC wallets) are unaffected and keep going through `signTypedData`.
   */
  sign?(args: { hash: `0x${string}` }): Promise<`0x${string}`>;
  address: `0x${string}`;
}

function isViemLocal(wallet: AbstractWallet): wallet is AbstractViemLocalAccount {
  return (
    "signTypedData" in wallet &&
    typeof wallet.signTypedData === "function" &&
    (wallet.signTypedData.length === 1 || wallet.signTypedData.length === 2) &&
    "address" in wallet &&
    typeof wallet.address === "string"
  );
}

function adaptViemLocal(wallet: AbstractViemLocalAccount): Signer {
  return {
    kind: "viem-local",
    async signTypedData(args: TypedDataArgs): Promise<Signature> {
      const hex = await wallet.signTypedData({
        domain: args.domain,
        types: mergeViemTypes(args.types),
        primaryType: args.primaryType,
        message: args.message,
      });
      return parseSignature(hex);
    },
    // A viem local account can sign a raw 32-byte digest locally; wire that up so callers with a
    // precomputed digest can skip the typed-data encoding round trip entirely.
    signDigest:
      typeof wallet.sign === "function"
        ? async (digest: `0x${string}`): Promise<Signature> => parseSignature(await wallet.sign!({ hash: digest }))
        : undefined,
    getAddress(): Promise<`0x${string}`> {
      return Promise.resolve(wallet.address.toLowerCase() as `0x${string}`);
    },
    getChainId(): Promise<`0x${string}`> {
      // Local accounts have no notion of chain; default to "0x1".
      return Promise.resolve("0x1");
    },
  };
}

// ============================================================
// AbstractWallet & Dispatcher
// ============================================================

/** Abstract interface for a wallet that can sign typed data. */
export type AbstractWallet = AbstractViemJsonRpcAccount | AbstractViemLocalAccount;

/** Cache of wallet adapters (keyed by wallet object identity; adaptation re-runs structural guards). */
const adapterCache = new WeakMap<AbstractWallet, Signer>();

/** Adapt a wallet of any supported kind to the uniform {@link Signer} interface (memoized per wallet object). */
function adapt(wallet: AbstractWallet): Signer {
  let signer = adapterCache.get(wallet);
  if (signer === undefined) {
    signer = createSigner(wallet);
    adapterCache.set(wallet, signer);
  }
  return signer;
}

/** Build the uniform {@link Signer} adapter for a wallet of any supported kind. */
function createSigner(wallet: AbstractWallet): Signer {
  if (isViemJsonRpc(wallet)) return adaptViemJsonRpc(wallet);
  if (isViemLocal(wallet)) return adaptViemLocal(wallet);
  throw new AbstractWalletError("Failed to adapt wallet: unknown wallet type");
}

// ============================================================
// Public API
// ============================================================

/** Cache of declared field names per EIP-712 type-fields array (keyed by array object identity). */
const typeFieldNamesCache = new WeakMap<readonly { name: string; type: string }[], Set<string>>();

/** Cache of wallet address promises (dedupes concurrent lookups, e.g. a live `eth_accounts` RPC per order). */
const addressCache = new WeakMap<AbstractWallet, Promise<`0x${string}`>>();

/** Cache of wallet chain ID promises. */
const chainIdCache = new WeakMap<AbstractWallet, Promise<`0x${string}`>>();

/**
 * Resolved wallet addresses for stable-identity wallets. Lets {@linkcode getWalletAddress} return a
 * settled value without awaiting the cached promise (an async hop) or re-deriving identity stability.
 */
const resolvedAddressCache = new WeakMap<AbstractWallet, `0x${string}`>();

/** Resolved chain IDs for stable-identity wallets — see {@linkcode resolvedAddressCache}. */
const resolvedChainIdCache = new WeakMap<AbstractWallet, `0x${string}`>();

/**
 * Returns the cached promise for a wallet, computing and caching it on first use.
 *
 * `stable` decides how long a *fulfilled* value may be reused:
 * - `true` — keep it for the life of the wallet object. Only correct when the answer cannot
 *   change: a viem local account carries a fixed address and has no notion of chain. The settled
 *   value is also recorded in `resolvedCache`, unlocking the synchronous fast path in the callers.
 * - `false` — evict as soon as the promise settles. A JSON-RPC wallet is a live connection whose
 *   selected account and network the user can change at any moment, so a fulfilled value must
 *   never outlive the call that produced it. Concurrent callers (a burst of orders sharing one
 *   wallet) still collapse onto a single round trip, which is where the cost actually was;
 *   the next burst re-reads the live value instead of signing against a stale one.
 *
 * A rejected promise is always evicted (and never reaches `resolvedCache`), so a transient
 * failure can be retried.
 */
function cachedPerWallet<T>(
  cache: WeakMap<AbstractWallet, Promise<T>>,
  wallet: AbstractWallet,
  stable: boolean,
  compute: () => Promise<T>,
  resolvedCache?: WeakMap<AbstractWallet, T>,
): Promise<T> {
  const cached = cache.get(wallet);
  if (cached !== undefined) return cached;

  const promise = compute();
  cache.set(wallet, promise);
  // Compare before deleting: a later call may already have replaced this entry.
  const evict = (): void => {
    if (cache.get(wallet) === promise) cache.delete(wallet);
  };
  if (stable) promise.then((value) => resolvedCache?.set(wallet, value), evict);
  else promise.then(evict, evict);
  return promise;
}

/** True when a wallet's address and chain cannot change under us, making a fulfilled value reusable. */
function hasStableIdentity(wallet: AbstractWallet): boolean {
  return adapt(wallet).kind === "viem-local";
}

/**
 * Signs [EIP-712](https://eips.ethereum.org/EIPS/eip-712) typed data using the provided wallet.
 *
 * @param args The wallet, domain, types, primary type, and message to sign.
 * @return The ECDSA signature components.
 *
 * @throws {AbstractWalletError} If the wallet type is unknown or signing fails.
 */
export async function signTypedData(args: {
  wallet: AbstractWallet;
  domain: TypedDataDomain;
  types: TypedDataTypes;
  primaryType: string;
  message: Record<string, unknown>;
}): Promise<Signature> {
  try {
    // Filter message to only contain fields defined in types (required by some wallets)
    const typeFields = args.types[args.primaryType];
    let message = args.message;
    if (typeFields) {
      let fieldNames = typeFieldNamesCache.get(typeFields);
      if (fieldNames === undefined) {
        fieldNames = new Set(typeFields.map((f) => f.name));
        typeFieldNamesCache.set(typeFields, fieldNames);
      }
      // Fast path: skip the rebuild when every message key is already declared
      let needsFilter = false;
      for (const key in message) {
        if (!fieldNames.has(key)) {
          needsFilter = true;
          break;
        }
      }
      if (needsFilter) {
        message = Object.fromEntries(Object.entries(message).filter(([key]) => fieldNames.has(key)));
      }
    }

    return await adapt(args.wallet).signTypedData({
      domain: args.domain,
      types: args.types,
      primaryType: args.primaryType,
      message,
    });
  } catch (error) {
    if (error instanceof AbstractWalletError) throw error;
    throw new AbstractWalletError(`Failed to sign the typed data using the wallet`, { cause: error });
  }
}

/**
 * Signs a raw 32-byte digest directly when the wallet supports it (a viem local account exposing
 * `sign`), bypassing EIP-712 encoding. Returns `undefined` for wallets without that capability —
 * JSON-RPC wallets among them — so the caller can fall back to {@linkcode signTypedData}.
 *
 * Internal to the signing module: the caller is responsible for computing a digest that is
 * byte-identical to what the typed-data path would have produced.
 *
 * @param args The wallet and the digest to sign.
 * @return The ECDSA signature components, or `undefined` when raw-digest signing is unsupported.
 *
 * @throws {AbstractWalletError} If the wallet type is unknown or signing fails.
 */
export async function signRawDigest(args: {
  /** Wallet to sign the digest. */
  wallet: AbstractWallet;
  /** The 32-byte digest to sign. */
  digest: `0x${string}`;
}): Promise<Signature | undefined> {
  const signDigest = adapt(args.wallet).signDigest;
  if (signDigest === undefined) return undefined;
  try {
    return await signDigest(args.digest);
  } catch (error) {
    if (error instanceof AbstractWalletError) throw error;
    throw new AbstractWalletError(`Failed to sign the digest using the wallet`, { cause: error });
  }
}

/**
 * Gets the lowercase wallet address from various wallet types.
 *
 * Concurrent calls for the same wallet share a single lookup. For a local account the resolved
 * address is reused thereafter; for a JSON-RPC wallet it is re-read on the next call, because the
 * user may have switched accounts in the meantime.
 *
 * @param wallet The wallet to query.
 * @return The lowercase wallet address as a hex string.
 *
 * @throws {AbstractWalletError} If getting the address fails or the wallet type is unknown.
 */
export async function getWalletAddress(wallet: AbstractWallet): Promise<`0x${string}`> {
  // Fast path: a settled stable-identity value — return it without the await hop and without
  // re-evaluating `hasStableIdentity`. Pending and non-stable wallets fall through unchanged.
  const resolved = resolvedAddressCache.get(wallet);
  if (resolved !== undefined) return resolved;
  try {
    return await cachedPerWallet(
      addressCache,
      wallet,
      hasStableIdentity(wallet),
      () => adapt(wallet).getAddress(),
      resolvedAddressCache,
    );
  } catch (error) {
    if (error instanceof AbstractWalletError) throw error;
    throw new AbstractWalletError("Failed to get an address from the wallet", { cause: error });
  }
}

/**
 * Gets the chain ID of the wallet.
 *
 * For wallets that have no notion of chain (e.g., a viem local account), defaults to `"0x1"`.
 *
 * Concurrent calls for the same wallet share a single lookup. For a local account the answer is a
 * constant and is reused; for a JSON-RPC wallet it is re-read on the next call, because the user may
 * have switched networks — and this value becomes the EIP-712 domain `chainId`, so a stale one would
 * produce a signature for the wrong chain.
 *
 * @param wallet The wallet to query.
 * @return The chain ID as a hex string.
 *
 * @throws {AbstractWalletError} If getting the chain ID fails or the wallet type is unknown.
 */
export async function getWalletChainId(wallet: AbstractWallet): Promise<`0x${string}`> {
  // Fast path: a settled stable-identity value — return it without the await hop and without
  // re-evaluating `hasStableIdentity`. Pending and non-stable wallets fall through unchanged.
  const resolved = resolvedChainIdCache.get(wallet);
  if (resolved !== undefined) return resolved;
  try {
    return await cachedPerWallet(
      chainIdCache,
      wallet,
      hasStableIdentity(wallet),
      () => adapt(wallet).getChainId(),
      resolvedChainIdCache,
    );
  } catch (error) {
    if (error instanceof AbstractWalletError) throw error;
    throw new AbstractWalletError("Failed to get the chain ID from the wallet", { cause: error });
  }
}
