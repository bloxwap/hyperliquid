/**
 * Configuration types for Exchange API requests.
 * @module
 */

import type { AbstractWallet } from "../../../../signing/mod.ts";
import type { IRequestTransport } from "../../../../transport/mod.ts";
import type { Runtime } from "../../../../transport/runtime.ts";
import type { SymbolConverter } from "../../../../utils/mod.ts";
import type { DispatchPolicy } from "./_dispatch.ts";

// ============================================================
// Type Utilities
// ============================================================

/** A value or a Promise of that value. */
type MaybePromise<T> = T | Promise<T>;

/** Flatten an intersection type for cleaner IDE display. */
// deno-lint-ignore ban-types
type Prettify<T> = { [K in keyof T]: T[K] } & {};

// ============================================================
// Configuration
// ============================================================

/** Base configuration shared by single-wallet and multi-sig configs. */
interface BaseConfig<T extends IRequestTransport = IRequestTransport> {
  /** The transport used to connect to the Hyperliquid Exchange API. */
  transport: T;

  /**
   * How signed requests for this signer/network reach the transport. Default: `"ordered"`, which
   * dispatches in nonce issuance order. `{ mode: "bounded" }` lets a ready signature overtake a
   * slower earlier one within the exchange's nonce window; it supports managed execution only.
   *
   * The default nonce manager is the only producer for a signer inside this realm (one process,
   * one worker, including every loaded copy of the SDK). Another OS process or worker thread is a
   * different realm and does not share it — use a separate API wallet, or pass one coordinated
   * `nonceManager`, for each.
   */
  dispatchPolicy?: DispatchPolicy;

  /**
   * Wall clock used to check that nonces and `expiresAfter` are millisecond timestamps inside the
   * protocol window, at issuance and again immediately before sending. Only `now` is read.
   * Default: the platform clock.
   */
  runtime?: Partial<Runtime>;

  /** Signature chain ID for EIP-712 signing, defaults to wallet's chain ID. */
  signatureChainId?: `0x${string}` | (() => MaybePromise<`0x${string}`>);

  /**
   * Default vault address for vault-based operations, used when not specified in action options.
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#subaccounts-and-vaults
   */
  defaultVaultAddress?: `0x${string}`;

  /**
   * Default expiration time in milliseconds, used when not specified in action options.
   *
   * Must be a safe-integer millisecond timestamp strictly after now and less than one day ahead.
   * A seconds value is rejected before signing, in every dispatch mode, including `skipValidation`.
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#expires-after
   */
  defaultExpiresAfter?: number | (() => MaybePromise<number>);

  /**
   * Custom nonce generator function.
   *
   * Defaults to a realm-wide manager: one map per signer address and network (`address:isTestnet`),
   * shared by every `ExchangeClient` and every copy of this package loaded in the same realm
   * (`globalThis`, so duplicate installs in one bundle do not collide). It uses `Date.now()` in
   * milliseconds and bumps by 1 when the previous nonce is already ahead of the clock.
   *
   * The returned value must be a safe-integer millisecond timestamp inside
   * `(now - 2 days, now + 1 day)`. Seconds, fractions, and out-of-window values throw
   * `HyperliquidError` before signing, in every dispatch mode.
   *
   * Not shared across OS processes or worker threads — each has its own realm. Give each its own
   * API wallet, or pass the same externally coordinated manager (for example backed by Redis).
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets#hyperliquid-nonces
   */
  nonceManager?: (address: string) => MaybePromise<number>;

  /**
   * Symbol converter used by `ExchangeClient` methods to resolve `coin` symbols (e.g. `"BTC"`,
   * `"HYPE/USDC"`) into raw asset IDs before dispatch.
   *
   * When omitted, the client lazily creates and loads one over the same transport on the first
   * symbol-based call. Pass a preloaded instance to control builder-dex support (`dexs` option)
   * or to avoid the metadata fetch on the first call. Ignored by the raw functions in
   * `@bloxwap/hyperliquid/api/exchange`, which take asset IDs only.
   */
  symbolConverter?: SymbolConverter;
}

/** Configuration for single-wallet Exchange API requests. */
export interface ExchangeSingleWalletConfig<T extends IRequestTransport = IRequestTransport> extends BaseConfig<T> {
  /**
   * The wallet used to sign requests.
   *
   * Either a wallet object (viem, ethers-shaped adapter, or custom signer) or a raw 32-byte hex
   * private key string. A key string is signed for in-process with the WASM secp256k1
   * implementation of the optional `tiny-secp256k1` dependency when it loads and passes its
   * self-check (the default in Node, Bun, and Deno), and with the pure-JS `@noble/curves`
   * implementation otherwise (the usual outcome in browsers and bundled apps, where the opaque
   * import cannot resolve) — silently, since the fallback is not something the user opted into.
   * Both backends produce byte-identical signatures, so the choice is never observable beyond
   * latency.
   *
   * A malformed key string throws `AbstractWalletError` synchronously from the `ExchangeClient`
   * constructor; a well-formed key outside the secp256k1 scalar range rejects on the first
   * signing call. To opt out of the WASM path entirely, pass a viem account
   * (`privateKeyToAccount(key)`) or `createFastLocalWallet(key, { wasm: false })` as before.
   */
  wallet: AbstractWallet | `0x${string}`;
}

/** Configuration for multi-signature Exchange API requests. */
export interface ExchangeMultiSigConfig<T extends IRequestTransport = IRequestTransport> extends BaseConfig<T> {
  /** Array of wallets for multi-sig. First wallet is the leader. */
  signers: readonly [AbstractWallet, ...AbstractWallet[]];
  /** The multi-signature account address. */
  multiSigUser: `0x${string}`;
}

/** Union type for all Exchange API configurations. */
export type ExchangeConfig<T extends IRequestTransport = IRequestTransport> =
  | ExchangeSingleWalletConfig<T>
  | ExchangeMultiSigConfig<T>;

// ============================================================
// Options
// ============================================================

/** Common options for execute functions. */
interface BaseOptions {
  /** {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel a request. */
  signal?: AbortSignal;

  /**
   * Opt-in escape hatch for trusted, performance-critical callers: skip request validation
   * (the valibot `parse` + canonicalization pass every exchange method runs before signing).
   *
   * **Unsafe for untrusted input.** When `true`, the SDK performs no validation, normalization,
   * default-filling, or key reordering on the action parameters — they are signed and posted
   * exactly as given. The caller must therefore supply parameters that are already in canonical
   * wire form:
   * - object keys in schema-declared order (the signature commits to the encoded key order);
   * - decimals as normalized strings (e.g. `"30000"`, not `3e4` or `"030000"`);
   * - addresses and hex strings in lowercase;
   * - every schema field with a default (e.g. `grouping: "na"`) provided explicitly.
   *
   * Invalid input on this path is the caller's problem: instead of a client-side
   * `ValidationError`, the server rejects the request — detecting that drift is the cost of the
   * saved microseconds. Client-side guards for documented constraints are cheap and still run:
   * `scheduleCancel`'s 5-second lead time, and the millisecond window on `nonce` and
   * `expiresAfter`.
   *
   * Default: `false` (validate).
   */
  skipValidation?: boolean;
}

/** Extract request options from a request type (excludes action, nonce, signature). */
export type ExtractRequestOptions<T extends { action: Record<string, unknown> }> = Prettify<
  BaseOptions & Omit<T, "action" | "nonce" | "signature">
>;
