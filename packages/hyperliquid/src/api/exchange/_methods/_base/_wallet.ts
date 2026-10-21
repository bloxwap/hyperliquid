/**
 * Resolution of {@linkcode ExchangeSingleWalletConfig.wallet} to an {@linkcode AbstractWallet}.
 * @module
 */

import type { AbstractWallet } from "../../../../signing/_abstractWallet.ts";
import { createPrivateKeyWallet } from "../../../../signing/_privateKeyWallet.ts";
import type { ExchangeSingleWalletConfig } from "./_config.ts";

/**
 * Carriers built for private-key-string configs, keyed by the CONFIG OBJECT (never by the key
 * string: a global map keyed by the key would pin every key ever seen for the life of the
 * process). The raw string is stored alongside so a config whose `wallet` field is reassigned
 * gets a freshly built carrier instead of silently signing with the old key.
 */
const carrierCache = new WeakMap<ExchangeSingleWalletConfig, { key: string; wallet: AbstractWallet }>();

/**
 * Returns the wallet a single-wallet config signs with: `config.wallet` unchanged for wallet
 * objects (viem, ethers-shaped adapters, custom signers), and a lazily-created private-key
 * carrier for a raw 32-byte hex key string. The carrier is cached per config object, so every
 * method of one `ExchangeClient` shares the same signer (and its one-time backend
 * initialization).
 *
 * @param config Single-wallet Exchange API configuration.
 * @return The wallet to sign with.
 *
 * @throws {AbstractWalletError} If `config.wallet` is a string but not a 32-byte hex private key.
 */
export function configWallet(config: ExchangeSingleWalletConfig): AbstractWallet {
  const wallet = config.wallet;
  if (typeof wallet !== "string") return wallet;
  // Hot path (every signed action): a cache hit skips the format check, which already ran when
  // the carrier was built for this exact string.
  const cached = carrierCache.get(config);
  if (cached !== undefined && cached.key === wallet) return cached.wallet;
  const carrier = createPrivateKeyWallet(wallet); // throws AbstractWalletError on a malformed key
  carrierCache.set(config, { key: wallet, wallet: carrier });
  return carrier;
}
