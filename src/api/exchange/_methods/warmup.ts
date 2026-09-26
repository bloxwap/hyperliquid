import { warmupSigning } from "../../../signing/mod.ts";
import { buildAction, type ExchangeConfig } from "./_base/mod.ts";
import { OrderRequest } from "./order.ts";

/** Sample order validated by {@linkcode warmup}; never signed or sent. */
const WARMUP_ORDER_ACTION = {
  type: "order",
  orders: [{ a: 0, b: true, p: "30000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
} as const;

/** Validation passes {@linkcode warmup} runs: enough invocations for the JIT to compile the path. */
const WARMUP_VALIDATIONS = 3;

/**
 * Warm the signing path so the first action signs at steady-state speed.
 *
 * A cold process signs its first order several times slower than later ones (measured ~5 ms vs
 * ~0.1 ms): the optional WASM keccak is still loading, the curve's precomputed tables are not
 * built yet, and none of the validation or signing code is compiled. Call this during start-up,
 * before the first latency-sensitive action.
 *
 * Signs throwaway data only with wallets whose key is held in this process (viem
 * `privateKeyToAccount` / `mnemonicToAccount` / `hdKeyToAccount`, `createFastLocalWallet`, or a
 * viem `WalletClient` wrapping one). JSON-RPC wallets and custom signers (HSM, MPC, remote
 * services) are never asked to sign; they get the hash-path warm-up only. Nothing is sent and no
 * nonce is consumed.
 *
 * @param config General configuration for Exchange API requests.
 * @return A promise that resolves when the warm-up has finished.
 *
 * @throws {AbstractWalletError} When an in-process wallet fails to sign.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { warmup } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await warmup({ transport, wallet });
 * ```
 */
export async function warmup(config: ExchangeConfig): Promise<void> {
  // Validate and canonicalize a sample order so the request-validation code is compiled too;
  // measured, this takes the first order from ~1.65 ms to ~1.1 ms after signing warm-up alone.
  for (let i = 0; i < WARMUP_VALIDATIONS; i++) buildAction(OrderRequest.entries.action, WARMUP_ORDER_ACTION);
  await warmupSigning("wallet" in config ? config.wallet : config.signers);
}
