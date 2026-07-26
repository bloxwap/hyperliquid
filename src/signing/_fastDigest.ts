/**
 * Hand-rolled EIP-712 digest for the fixed L1 `Agent` message shape.
 *
 * Every L1 signature signs the same shape — domain `{ name: "Exchange", version: "1", chainId: 1337,
 * verifyingContract: 0x0 }`, message `Agent(string source,bytes32 connectionId)` with `source` only ever
 * `"a"` (mainnet) or `"b"` (testnet) — so the typehashes, the domain separator, and both `source` hashes
 * are module-level constants and a digest costs two `keccak_256` calls over fixed offsets (~4 µs instead
 * of ~43 µs through viem's generic `hashTypedData`).
 *
 * The output is byte-identical to viem's `hashTypedData` for this shape; `tests/signing/fastDigest.test.ts`
 * pins the constants to literals and diffs the digest and the resulting signature against viem.
 * @module
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const ENCODER = new TextEncoder();

/** Typehash of the fixed `EIP712Domain` type. */
const EIP712_DOMAIN_TYPEHASH = keccak_256(
  ENCODER.encode("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

/** Typehash of the L1 `Agent(string source,bytes32 connectionId)` message type. */
const AGENT_TYPEHASH = keccak_256(ENCODER.encode("Agent(string source,bytes32 connectionId)"));

/** Domain separator of the L1 domain; `verifyingContract` is the zero address (32 zero bytes). */
const L1_DOMAIN_SEPARATOR = (() => {
  const preimage = new Uint8Array(32 * 5);
  preimage.set(EIP712_DOMAIN_TYPEHASH, 0);
  preimage.set(keccak_256(ENCODER.encode("Exchange")), 32);
  preimage.set(keccak_256(ENCODER.encode("1")), 64);
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
  const struct = new Uint8Array(32 * 3);
  struct.set(AGENT_TYPEHASH, 0);
  struct.set(isTestnet ? SOURCE_HASH_TESTNET : SOURCE_HASH_MAINNET, 32);
  struct.set(hexToBytes(actionHash.slice(2)), 64);
  const structHash = keccak_256(struct);

  const digest = new Uint8Array(2 + 32 + 32);
  digest[0] = 0x19;
  digest[1] = 0x01;
  digest.set(L1_DOMAIN_SEPARATOR, 2);
  digest.set(structHash, 34);
  return `0x${bytesToHex(keccak_256(digest))}`;
}
