/**
 * Common execution shell shared by L1 and user-signed Exchange API actions.
 * @module
 */

import { getWalletAddress, type Signature } from "../../../../signing/mod.ts";
import type { ExchangeConfig } from "./_config.ts";
import { assertSuccessResponse } from "./errors.ts";
import { globalNonceManager } from "./_nonce.ts";
import { withLock } from "./_semaphore.ts";

/** Result returned by the {@linkcode executeWithShell} `build` callback. */
export interface BuildResult {
  /** The final action to send (post-signing). Shape is opaque to the shell — passed through to the transport. */
  action: unknown;
  /** The signature to send. */
  signature: Signature;
  /** Optional extra fields to merge into the request payload (e.g., `vaultAddress`, `expiresAfter`). */
  extras?: Record<string, unknown>;
}

/**
 * A fully signed Exchange request captured before submission: the exact wire payload of one
 * Exchange API call, ready to be posted later via `submitPrepared`.
 *
 * Produced by `prepareRequest`. The signature commits to `action` and `nonce`, and the nonce was
 * consumed at prepare time. The payload stays valid while its nonce is among the 100 highest the
 * exchange has seen from the wallet (and within the block-timestamp window) — it goes stale only
 * after 100 newer nonces have been consumed.
 *
 * @template T Response type of the method the payload was prepared with (type-level only).
 */
export interface PreparedExchangeRequest<T = unknown> {
  /** The final action as posted (canonicalized; the multi-sig wrapper when applicable). */
  action: Record<string, unknown>;
  /** The leader's ECDSA signature over the action and nonce. */
  signature: Signature;
  /** Nonce (timestamp in ms) the signature commits to. */
  nonce: number;
  /** Vault address, when the request trades on behalf of a vault or sub-account. */
  vaultAddress?: string;
  /** Expiration time of the action, when set. */
  expiresAfter?: number;
  /**
   * Phantom carrier of the wrapped method's response type — never set at runtime; it only lets
   * `submitPrepared` infer the response type of the method the payload was prepared with.
   */
  readonly __responseType?: T;
}

// ============================================================
// Prepared-payload poison state (internal)
// ============================================================

/**
 * Mutable state shared between a `prepareRequest` capture transport and the payload it produced.
 *
 * The capture transport increments {@linkcode PreparedRequestState.invalidAttempts} on ANY invalid
 * attempt — a request to a non-`exchange` endpoint, a second request, or a request attempted after
 * `prepareRequest` settled. Because the state is shared by reference, an attempt that begins only
 * after `prepareRequest` returned (leaked callback work) still lands here, and `submitPrepared`
 * rejects the poisoned payload when it re-checks (a point-in-time, best-effort check).
 */
export interface PreparedRequestState {
  /** Number of invalid attempts recorded by the capture transport. */
  invalidAttempts: number;
}

/**
 * In-process link from a prepared payload to its capture-transport state. A `WeakMap` (rather than
 * a property on the payload) keeps the wire body untouched; the link is intentionally lost when a
 * payload is serialized and re-parsed (the poison guard is an in-process guard only).
 */
const preparedRequestStates = new WeakMap<PreparedExchangeRequest<unknown>, PreparedRequestState>();

/** Links a prepared payload to its capture-transport state (called by `prepareRequest`). */
export function linkPreparedRequestState(
  prepared: PreparedExchangeRequest<unknown>,
  state: PreparedRequestState,
): void {
  preparedRequestStates.set(prepared, state);
}

/** Returns the capture-transport state of a prepared payload, if any (called by `submitPrepared`). */
export function getPreparedRequestState(prepared: PreparedExchangeRequest<unknown>): PreparedRequestState | undefined {
  return preparedRequestStates.get(prepared);
}

/**
 * Cache of the nonce-lock key per (leader wallet × transport), keyed by object identity so a wallet
 * object is dropped from the cache when the caller drops it. The cached entry is only reused while
 * the wallet's current address and the transport's testnet flag still match it — a JSON-RPC wallet
 * whose selected account changed gets a freshly built key for the new address.
 */
const nonceKeyCache = new WeakMap<
  object,
  WeakMap<object, { walletAddress: string; isTestnet: boolean; key: string }>
>();

/**
 * Per-`(walletAddress × isTestnet)` dispatch chain: resolves once the request holding the previous
 * nonce has been handed to the transport.
 *
 * The nonce lock guarantees the order nonces are ISSUED in; this guarantees the order they reach
 * the WIRE in, which is what the server actually requires. Keeping the two separate is what lets
 * signing — a network round trip for any remote wallet — run outside the lock and overlap across
 * callers, while a later nonce still cannot overtake an earlier one.
 *
 * Entries are dropped as soon as the chain goes idle, so a long-lived process that touches many
 * wallets does not accumulate one per key forever.
 */
const dispatchChains = new Map<string, Promise<void>>();

/**
 * Common shell for executing an Exchange API request:
 * acquires per-`(walletAddress × isTestnet)` lock, generates nonce, calls `build` to construct
 * the signed payload, sends to the Exchange endpoint, and validates the response.
 *
 * The lock covers only nonce issuance and claiming a slot in the per-wallet dispatch chain — both
 * synchronous. Signing happens outside it, so concurrent callers on one wallet sign at the same
 * time; for a remote wallet, where signing is an `eth_signTypedData_v4` round trip, that is the
 * difference between one order in flight per wallet and all of them.
 *
 * Wire order is preserved by {@linkcode dispatchChains} rather than by the lock: a request waits
 * for its predecessor to reach `transport.request` before making its own call, so the server still
 * sees strictly increasing nonces per wallet. Network responses resolve concurrently.
 *
 * @param config Exchange API configuration.
 * @param build Callback that, given the nonce, returns the action, signature, and any extras.
 * @param signal Optional {@link AbortSignal} to cancel the request.
 * @return The validated API response.
 *
 * @throws {ApiRequestError} If the API returns an error response.
 */
export async function executeWithShell<T>(
  config: ExchangeConfig,
  build: (nonce: number) => Promise<BuildResult>,
  signal?: AbortSignal,
): Promise<T> {
  const leader = "wallet" in config ? config.wallet : config.signers[0];
  const walletAddress = await getWalletAddress(leader);

  // Lock per (wallet × testnet) ensures requests are dispatched to the server in nonce order.
  // The key string is cached per (wallet × transport); it is rebuilt only when the wallet's
  // address or the transport's testnet flag no longer matches the cached entry.
  const isTestnet = config.transport.isTestnet;
  let perTransport = nonceKeyCache.get(leader);
  const cached = perTransport?.get(config.transport);
  let key: string;
  if (cached !== undefined && cached.walletAddress === walletAddress && cached.isTestnet === isTestnet) {
    key = cached.key;
  } else {
    key = `${walletAddress}:${isTestnet}`;
    if (perTransport === undefined) {
      perTransport = new WeakMap();
      nonceKeyCache.set(leader, perTransport);
    }
    perTransport.set(config.transport, { walletAddress, isTestnet, key });
  }
  const box = await withLock(key, async () => {
    // --- Generate nonce --------------------------------------
    // `globalNonceManager.getNonce` returns a plain number: skip the await (and its async hop)
    // unless a custom `nonceManager` actually handed back a promise.
    const nonceOrPromise = config.nonceManager?.(walletAddress) ?? globalNonceManager.getNonce(key);
    const nonce = typeof nonceOrPromise === "number" ? nonceOrPromise : await nonceOrPromise;

    // --- Claim this nonce's slot in the dispatch order --------
    // Taken under the lock, so slots are claimed in the same order nonces are issued.
    const predecessor = dispatchChains.get(key);
    let openGate!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    dispatchChains.set(key, dispatched);

    // --- Sign and dispatch, outside the lock ------------------
    // Signing is a network round trip for a remote wallet; running it here rather than inside the
    // lock lets concurrent callers on one wallet sign at the same time. The `predecessor` await
    // then restores order at the only point it matters — handing the request to the transport.
    const pending = (async (): Promise<T> => {
      let response: Promise<T> | undefined;
      try {
        const { action, signature, extras } = await build(nonce);
        if (predecessor !== undefined) await predecessor;
        // `transport.request` runs synchronously up to its first await, so wire order is fixed
        // here. It is assigned rather than awaited so the gate below opens on dispatch, not on
        // the response.
        response = config.transport.request<T>("exchange", { action, signature, nonce, ...extras }, signal);
      } finally {
        // Wait for our turn even when this request never reached the wire. A rejected signature
        // or an abort burns its nonce, which the server tolerates as a gap — but opening the gate
        // early would let a later nonce overtake an earlier one that is still being signed.
        if (predecessor !== undefined) await predecessor;
        openGate();
        // Idle chain: drop the entry so the map does not grow one slot per key forever. Compared
        // by identity, so a successor that has already claimed the slot is left alone.
        if (dispatchChains.get(key) === dispatched) dispatchChains.delete(key);
      }
      return await response;
    })();

    // Hand the pending promise out in a plain (non-thenable) box, so the lock releases
    // without awaiting either the signature or the network response.
    return { pending };
  });

  // --- Await response (concurrently across calls) and validate
  const response = await box.pending;
  assertSuccessResponse(response);
  return response;
}
