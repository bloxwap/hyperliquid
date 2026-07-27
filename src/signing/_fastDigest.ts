/**
 * Hand-rolled EIP-712 digests for the fixed message shapes on the signing hot paths.
 *
 * Two shapes never change across calls:
 * - L1 `Agent` — domain `{ name: "Exchange", version: "1", chainId: 1337, verifyingContract: 0x0 }`,
 *   message `Agent(string source,bytes32 connectionId)` with `source` only ever `"a"` (mainnet) or
 *   `"b"` (testnet) — so the typehashes, the domain separator, and both `source` hashes are
 *   module-level constants and a digest costs two `keccak_256` calls over fixed offsets (~4 µs
 *   instead of ~43 µs through viem's generic `hashTypedData`).
 * - Multi-sig outer `HyperliquidTransaction:SendMultiSig(string hyperliquidChain,bytes32
 *   multiSigActionHash,uint64 nonce)` — domain `{ name: "HyperliquidSignTransaction", version: "1",
 *   chainId: signatureChainId, verifyingContract: 0x0 }`, `hyperliquidChain` only ever `"Mainnet"`
 *   or `"Testnet"`. Same treatment, except the chain ID is caller-chosen, so the domain separator
 *   is computed once per `signatureChainId` and cached instead of being a module constant.
 *
 * The outputs are byte-identical to viem's `hashTypedData` for these shapes;
 * `tests/signing/fastDigest.test.ts` and `tests/signing/multiSigDigest.test.ts` pin the constants
 * to literals and diff the digests and the resulting signatures against viem.
 * @module
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { keccak256 } from "./_keccak.ts";

const ENCODER = new TextEncoder();

// The module-level constants hash through noble's `keccak_256` directly, NOT the `keccak256`
// dispatch: they run at module load, when the WASM provider can never be ready, and dispatching
// here would kick the background load for users who never hash a single action.

/** Typehash of the fixed `EIP712Domain` type. */
const EIP712_DOMAIN_TYPEHASH = keccak_256(
  ENCODER.encode("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

/** Typehash of the L1 `Agent(string source,bytes32 connectionId)` message type. */
const AGENT_TYPEHASH = keccak_256(ENCODER.encode("Agent(string source,bytes32 connectionId)"));

/** `keccak256("1")` — the `version` hash shared by the L1 and multi-sig domains. */
const DOMAIN_VERSION_HASH = keccak_256(ENCODER.encode("1"));

/** Domain separator of the L1 domain; `verifyingContract` is the zero address (32 zero bytes). */
const L1_DOMAIN_SEPARATOR = (() => {
  const preimage = new Uint8Array(32 * 5);
  preimage.set(EIP712_DOMAIN_TYPEHASH, 0);
  preimage.set(keccak_256(ENCODER.encode("Exchange")), 32);
  preimage.set(DOMAIN_VERSION_HASH, 64);
  preimage[96 + 30] = 0x05; // uint256(1337) = 0x539, big-endian
  preimage[96 + 31] = 0x39;
  return keccak_256(preimage);
})();

/** `keccak256("a")` — the `source` hash for mainnet actions. */
const SOURCE_HASH_MAINNET = keccak_256(ENCODER.encode("a"));

/** `keccak256("b")` — the `source` hash for testnet actions. */
const SOURCE_HASH_TESTNET = keccak_256(ENCODER.encode("b"));

/**
 * Computes the EIP-712 digest of the L1 `Agent` message for a precomputed action hash.
 *
 * `digest = keccak256(0x1901 ‖ domainSeparator ‖ keccak256(agentTypehash ‖ keccak256(source) ‖ connectionId))`
 *
 * @param actionHash The L1 action hash, used as the `connectionId`.
 * @param isTestnet Selects the `source` value (`"b"` for testnet, `"a"` for mainnet).
 * @return The 32-byte digest as a hex string, byte-identical to viem's `hashTypedData`.
 */
export function createL1AgentDigest(actionHash: `0x${string}`, isTestnet: boolean): `0x${string}` {
  return `0x${bytesToHex(createL1AgentDigestBytes(hexToBytes(actionHash.slice(2)), isTestnet))}`;
}

/**
 * Bytes-level variant of {@linkcode createL1AgentDigest}: takes the action hash and returns the
 * digest as `Uint8Array`, so the L1 signing path passes bytes end-to-end instead of round-tripping
 * through hex. Package-internal — not re-exported from `mod.ts`.
 *
 * @param actionHash The 32-byte L1 action hash, used as the `connectionId`.
 * @param isTestnet Selects the `source` value (`"b"` for testnet, `"a"` for mainnet).
 * @return The 32-byte digest, byte-identical to viem's `hashTypedData`.
 */
export function createL1AgentDigestBytes(actionHash: Uint8Array, isTestnet: boolean): Uint8Array {
  const struct = new Uint8Array(32 * 3);
  struct.set(AGENT_TYPEHASH, 0);
  struct.set(isTestnet ? SOURCE_HASH_TESTNET : SOURCE_HASH_MAINNET, 32);
  struct.set(actionHash, 64);
  const structHash = keccak256(struct);

  const digest = new Uint8Array(2 + 32 + 32);
  digest[0] = 0x19;
  digest[1] = 0x01;
  digest.set(L1_DOMAIN_SEPARATOR, 2);
  digest.set(structHash, 34);
  return keccak256(digest);
}

// --- Multi-sig outer digest --------------------------------------------------

/** Typehash of the fixed `HyperliquidTransaction:SendMultiSig` message type. */
const SEND_MULTI_SIG_TYPEHASH = keccak_256(
  ENCODER.encode(
    "HyperliquidTransaction:SendMultiSig(string hyperliquidChain,bytes32 multiSigActionHash,uint64 nonce)",
  ),
);

/** `keccak256("HyperliquidSignTransaction")` — the `name` hash of the multi-sig domain. */
const MULTI_SIG_DOMAIN_NAME_HASH = keccak_256(ENCODER.encode("HyperliquidSignTransaction"));

/** `keccak256("Mainnet")` — the `hyperliquidChain` hash for mainnet actions. */
const HYPERLIQUID_CHAIN_HASH_MAINNET = keccak_256(ENCODER.encode("Mainnet"));

/** `keccak256("Testnet")` — the `hyperliquidChain` hash for testnet actions. */
const HYPERLIQUID_CHAIN_HASH_TESTNET = keccak_256(ENCODER.encode("Testnet"));

/**
 * Cache of multi-sig domain separators keyed by numeric chain ID. Unlike the L1 domain, the chain
 * ID is caller-chosen (`signatureChainId`), so the separator is computed lazily on first use of a
 * chain — through the `keccak256` dispatch, WASM acceleration included — and reused thereafter.
 */
const MULTI_SIG_DOMAIN_SEPARATORS = new Map<number, Uint8Array>();

/** Domain separator of the multi-sig domain for `chainId`; `verifyingContract` is the zero address. */
function multiSigDomainSeparator(chainId: number): Uint8Array {
  let separator = MULTI_SIG_DOMAIN_SEPARATORS.get(chainId);
  if (separator === undefined) {
    const preimage = new Uint8Array(32 * 5);
    preimage.set(EIP712_DOMAIN_TYPEHASH, 0);
    preimage.set(MULTI_SIG_DOMAIN_NAME_HASH, 32);
    preimage.set(DOMAIN_VERSION_HASH, 64);
    // uint256(chainId), big-endian; the loop is exact for every safe integer
    for (let i = 96 + 31, remaining = chainId; remaining > 0; i--, remaining = Math.floor(remaining / 256)) {
      preimage[i] = remaining % 256;
    }
    // `verifyingContract` is the zero address, so the last word stays zeroed
    separator = keccak256(preimage);
    MULTI_SIG_DOMAIN_SEPARATORS.set(chainId, separator);
  }
  return separator;
}

/**
 * Computes the EIP-712 digest of the fixed multi-sig outer message for a precomputed wrapper hash.
 *
 * `digest = keccak256(0x1901 ‖ domainSeparator ‖ keccak256(sendMultiSigTypehash ‖
 * keccak256(hyperliquidChain) ‖ multiSigActionHash ‖ uint64(nonce)))`
 *
 * @param multiSigActionHash The hash of the multi-sig wrapper, used as the `multiSigActionHash`.
 * @param nonce The request nonce (`uint64`).
 * @param signatureChainId Chain ID of the EIP-712 domain, as a `0x`-prefixed hex string.
 * @param isTestnet Selects the `hyperliquidChain` value (`"Testnet"` for testnet, `"Mainnet"` for mainnet).
 * @return The 32-byte digest as a hex string, byte-identical to viem's `hashTypedData`.
 */
export function createMultiSigDigest(
  multiSigActionHash: `0x${string}`,
  nonce: number,
  signatureChainId: `0x${string}`,
  isTestnet: boolean,
): `0x${string}` {
  return `0x${bytesToHex(createMultiSigDigestBytes(hexToBytes(multiSigActionHash.slice(2)), nonce, signatureChainId, isTestnet))}`;
}

/**
 * Bytes-level variant of {@linkcode createMultiSigDigest}: takes the wrapper hash and returns the
 * digest as `Uint8Array`, so the multi-sig signing path passes bytes end-to-end instead of
 * round-tripping through hex. Package-internal — not re-exported from `mod.ts`.
 *
 * @param multiSigActionHash The 32-byte hash of the multi-sig wrapper.
 * @param nonce The request nonce (`uint64`).
 * @param signatureChainId Chain ID of the EIP-712 domain, as a `0x`-prefixed hex string.
 * @param isTestnet Selects the `hyperliquidChain` value (`"Testnet"` for testnet, `"Mainnet"` for mainnet).
 * @return The 32-byte digest, byte-identical to viem's `hashTypedData`.
 */
export function createMultiSigDigestBytes(
  multiSigActionHash: Uint8Array,
  nonce: number,
  signatureChainId: `0x${string}`,
  isTestnet: boolean,
): Uint8Array {
  const struct = new Uint8Array(32 * 4);
  struct.set(SEND_MULTI_SIG_TYPEHASH, 0);
  struct.set(isTestnet ? HYPERLIQUID_CHAIN_HASH_TESTNET : HYPERLIQUID_CHAIN_HASH_MAINNET, 32);
  struct.set(multiSigActionHash, 64);
  // uint64(nonce) zero-padded to a 32-byte word, big-endian
  for (let i = 96 + 31, remaining = nonce; remaining > 0; i--, remaining = Math.floor(remaining / 256)) {
    struct[i] = remaining % 256;
  }
  const structHash = keccak256(struct);

  const digest = new Uint8Array(2 + 32 + 32);
  digest[0] = 0x19;
  digest[1] = 0x01;
  // `signatureChainId` is a `0x`-prefixed hex string, so radix 16 is the only correct base here:
  // radix 10 would parse it as `0` and silently sign under the wrong EIP-712 domain.
  digest.set(multiSigDomainSeparator(parseInt(signatureChainId, 16)), 2);
  digest.set(structHash, 34);
  return keccak256(digest);
}
