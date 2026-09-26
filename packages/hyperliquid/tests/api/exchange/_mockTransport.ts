/**
 * Shared harness for offline Exchange API tests: a recording mock transport plus deterministic
 * local wallets and prebuilt configs (single-wallet and multi-sig). Signing happens locally,
 * so tests built on this harness never touch the network and run under `HL_OFFLINE=1`.
 * @module
 */

import type { IRequestTransport } from "@bloxwap/hyperliquid";
import type { ExchangeMultiSigConfig, ExchangeSingleWalletConfig } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

// ============================================================
// Wallets
// ============================================================

/** Deterministic local wallet (also the multi-sig leader). */
export const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

/** Second multi-sig signer. */
export const secondSigner = privateKeyToAccount("0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff");

/** Multi-sig account address used by {@linkcode multiSigConfig}. */
export const MULTI_SIG_USER = "0x1234567890123456789012345678901234567890" as const;

// ============================================================
// Constants
// ============================================================

/** Fixed nonce for every config built here, so signed payloads are deterministic byte-for-byte. */
export const FIXED_NONCE = 1_700_000_000_000;

/** Fixed signature chain ID, so user-signed actions are deterministic. */
export const SIGNATURE_CHAIN_ID = "0x66eee" as const;

/**
 * Generic success envelope: `assertSuccessResponse` only rejects error shapes, so this passes
 * the response check of every Exchange method regardless of its specific response type.
 */
export const SUCCESS = { status: "ok", response: { type: "default" } } as const;

/** Reusable valid order in canonical wire form. */
export const LIMIT_ORDER = { a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } } as const;

/** Reusable valid 128-bit client order ID. */
export const CLOID = "0x17a5a40306205a0c6d60c7264153781c" as const;

// ============================================================
// Recording transport
// ============================================================

/** One request as seen by the mock transport. */
export interface RecordedRequest {
  endpoint: "info" | "exchange";
  /** The posted payload (`{ action, signature, nonce, ... }` for exchange requests). */
  payload: {
    action: Record<string, unknown>;
    signature: { r: string; s: string; v: number };
    nonce: number;
  } & Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Creates a transport that records every request and resolves with `response`
 * (the generic {@linkcode SUCCESS} envelope unless overridden).
 */
export function recordingTransport(response: unknown = SUCCESS): {
  calls: RecordedRequest[];
  transport: IRequestTransport;
} {
  const calls: RecordedRequest[] = [];
  return {
    calls,
    transport: {
      isTestnet: true,
      request<T>(endpoint: "info" | "exchange", payload: unknown, signal?: AbortSignal): Promise<T> {
        calls.push({ endpoint, payload: payload as RecordedRequest["payload"], signal });
        return Promise.resolve(response as T);
      },
    },
  };
}

/** Creates a transport that rejects every request with `error` (error-passthrough tests). */
export function failingTransport(error: unknown): { calls: RecordedRequest[]; transport: IRequestTransport } {
  const calls: RecordedRequest[] = [];
  return {
    calls,
    transport: {
      isTestnet: true,
      request<T>(endpoint: "info" | "exchange", payload: unknown, signal?: AbortSignal): Promise<T> {
        calls.push({ endpoint, payload: payload as RecordedRequest["payload"], signal });
        return Promise.reject(error);
      },
    },
  };
}

// ============================================================
// Configs
// ============================================================

/**
 * Single-wallet config over the given transport with a fixed nonce and signature chain ID.
 * Extra config fields (e.g. `defaultVaultAddress`, `defaultExpiresAfter`) can be overridden/added.
 */
export function singleWalletConfig(
  transport: IRequestTransport,
  extra?: Partial<ExchangeSingleWalletConfig>,
): ExchangeSingleWalletConfig {
  return {
    transport,
    wallet,
    nonceManager: () => FIXED_NONCE,
    signatureChainId: SIGNATURE_CHAIN_ID,
    ...extra,
  };
}

/** Multi-sig config over the given transport (leader: {@linkcode wallet}, plus a second signer). */
export function multiSigConfig(
  transport: IRequestTransport,
  extra?: Partial<ExchangeMultiSigConfig>,
): ExchangeMultiSigConfig {
  return {
    transport,
    signers: [wallet, secondSigner],
    multiSigUser: MULTI_SIG_USER,
    nonceManager: () => FIXED_NONCE,
    signatureChainId: SIGNATURE_CHAIN_ID,
    ...extra,
  };
}
