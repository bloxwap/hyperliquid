/**
 * Ahead-of-time warm-up of the signing path.
 *
 * The first L1 signature in a process is several times slower than the steady state: the optional
 * WASM keccak (`_keccak.ts`) only starts loading on the first hash, noble's secp256k1 builds its
 * base-point tables on the first signature, and none of the msgpack / digest / curve code has been
 * compiled yet. Measured on an M3 Max (Bun 1.4, viem `privateKeyToAccount`), a cold process's first
 * `ExchangeClient.order` took ~4–6 ms against ~0.1 ms warm; running {@linkcode warmupSigning} first
 * brought it to ~1.8 ms. A bot that fires its first order on a signal right after start-up pays
 * that difference on exactly the order it cares about most.
 *
 * Warm-up signs only with keys that live in this process, because signing is the one step with a
 * side effect outside the process when the key does not: a custom signer (HSM, MPC, a remote
 * service) is billed, logged or rate-limited per signature, and a JSON-RPC wallet may prompt the
 * user. See {@linkcode isInProcessKey} for the exact rule; every other wallet gets the hash-path
 * warm-up only.
 * @module
 */

import { type AbstractWallet, SIGN_DIGEST_BYTES } from "./_abstractWallet.ts";
import { createL1AgentDigestBytes } from "./_fastDigest.ts";
import { preloadWasmKeccak } from "./_keccak.ts";
import { createL1ActionHashBytes, signL1Action } from "./_l1.ts";

/**
 * A representative single-order action: the warm-up must drive the same msgpack branches (maps,
 * short strings, small integers, booleans) a real order does. Never sent anywhere.
 */
const WARMUP_ACTION = {
  type: "order",
  orders: [{ a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
} as const;

/**
 * Throwaway signatures per in-process wallet. One builds noble's tables; the extra rounds give the
 * JIT enough invocations to compile the signing path before the first real order runs through it.
 */
const WARMUP_SIGNATURES = 3;

/** viem `LocalAccount.source` values whose key material is held in this process. */
const IN_PROCESS_SOURCES: ReadonlySet<unknown> = new Set(["privateKey", "hd"]);

/**
 * Whether signing with `wallet` is a pure in-process computation with no outside side effect.
 *
 * - `createFastLocalWallet` accounts carry the internal bytes-level digest capability.
 * - viem accounts from `privateKeyToAccount` / `mnemonicToAccount` / `hdKeyToAccount` are tagged
 *   `type: "local"` with `source` `"privateKey"` or `"hd"`. `toAccount` custom signers are tagged
 *   `source: "custom"` and are excluded, since they may front an HSM or remote service.
 * - A viem `WalletClient` qualifies when the account it wraps does.
 *
 * Anything unrecognized is treated as remote: skipping a warm-up signature costs latency, while
 * sending one to a remote signer costs the user something they did not ask for.
 */
function isInProcessKey(wallet: AbstractWallet): boolean {
  const account = wallet as { type?: unknown; source?: unknown; [SIGN_DIGEST_BYTES]?: unknown };
  if (typeof account[SIGN_DIGEST_BYTES] === "function") return true;
  if (account.type === "local" && IN_PROCESS_SOURCES.has(account.source)) return true;
  const embedded = (wallet as { account?: unknown }).account;
  return typeof embedded === "object" && embedded !== null && isInProcessKey(embedded as AbstractWallet);
}

/**
 * Warms the L1 signing path so the first real signature runs at steady-state speed.
 *
 * Always: waits for the optional WASM keccak (`hash-wasm`) to finish loading — resolving normally
 * when it is not installed — and runs the action-hash and `Agent`-digest code once. Then, for each
 * given wallet whose key lives in this process, signs a throwaway order action a few times, which
 * builds the curve's precomputed tables and compiles the signing code. Wallets that may sign
 * elsewhere (JSON-RPC wallets, custom HSM / MPC / remote signers) are never asked to sign.
 *
 * Nothing is sent and no nonce is consumed. Safe to call more than once; later calls are cheap.
 *
 * @param wallets The wallet(s) that will sign, or none for the hash-path warm-up only.
 * @throws {AbstractWalletError} If an in-process wallet fails to sign — the same failure the first
 *   real action would hit, surfaced before trading starts rather than on it.
 *
 * @example
 * ```ts
 * import { warmupSigning } from "@bloxwap/hyperliquid/signing";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * await warmupSigning(wallet); // before the first order, e.g. during start-up
 * ```
 */
export async function warmupSigning(wallets?: AbstractWallet | readonly AbstractWallet[]): Promise<void> {
  await preloadWasmKeccak();

  // The hash path runs for every wallet kind, including the ones never asked to sign below.
  const actionHash = createL1ActionHashBytes({ action: WARMUP_ACTION, nonce: 0 });
  createL1AgentDigestBytes(actionHash, true);

  const list: readonly AbstractWallet[] = wallets === undefined ? [] : Array.isArray(wallets) ? wallets : [wallets];
  for (const wallet of list) {
    if (!isInProcessKey(wallet)) continue;
    for (let i = 0; i < WARMUP_SIGNATURES; i++) {
      await signL1Action({ wallet, action: WARMUP_ACTION, nonce: i, isTestnet: true });
    }
  }
}
