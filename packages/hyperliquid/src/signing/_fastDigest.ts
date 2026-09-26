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
 * User-signed actions (`HyperliquidTransaction:ApproveAgent`, `:UsdSend`, …) share the multi-sig
 * domain but vary in shape, so they get a generic treatment: the typehash and field descriptors
 * are compiled once per `types` object identity (WeakMap), the domain separator is the same
 * per-chain-ID cache, and a digest then costs one keccak per string/bytes field plus two for the
 * struct and envelope. Shapes the encoder cannot reproduce byte-identically (nested structs,
 * arrays, fixed `bytesN`, checksummed mixed-case addresses) compile to no plan at all, and the
 * caller falls back to viem's generic encoding.
 *
 * The outputs are byte-identical to viem's `hashTypedData` for these shapes;
 * `tests/signing/fastDigest.test.ts`, `tests/signing/multiSigDigest.test.ts`, and
 * `tests/signing/userSignedDigest.test.ts` pin the constants to literals and diff the digests and
 * the resulting signatures against viem.
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
 * Reused struct/digest preimage buffers for {@linkcode createL1AgentDigestBytes}. Safe because the
 * function is synchronous; {@linkcode AGENT_SCRATCH_BUSY} covers the one way it can still overlap
 * with itself (a getter on a caller-supplied array buffer is impossible here — the inputs are
 * plain `Uint8Array`s — but a re-entrant call through a mocked `keccak256` is not).
 */
const AGENT_STRUCT = new Uint8Array(32 * 3);
const AGENT_DIGEST = new Uint8Array(2 + 32 + 32);
AGENT_DIGEST[0] = 0x19;
AGENT_DIGEST[1] = 0x01;
let AGENT_SCRATCH_BUSY = false;

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
  const nested = AGENT_SCRATCH_BUSY;
  const struct = nested ? new Uint8Array(32 * 3) : AGENT_STRUCT;
  const digest = nested ? new Uint8Array(2 + 32 + 32) : AGENT_DIGEST;
  AGENT_SCRATCH_BUSY = true;
  try {
    struct.set(AGENT_TYPEHASH, 0);
    struct.set(isTestnet ? SOURCE_HASH_TESTNET : SOURCE_HASH_MAINNET, 32);
    struct.set(actionHash, 64);
    const structHash = keccak256(struct);

    digest[0] = 0x19;
    digest[1] = 0x01;
    digest.set(L1_DOMAIN_SEPARATOR, 2);
    digest.set(structHash, 34);
    return keccak256(digest);
  } finally {
    AGENT_SCRATCH_BUSY = nested;
  }
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
 * Cache of `HyperliquidSignTransaction` domain separators keyed by numeric chain ID. The chain ID
 * is caller-chosen (`signatureChainId`), so the separator is computed lazily on first use of a
 * chain — through the `keccak256` dispatch, WASM acceleration included — and reused thereafter.
 * Shared by the multi-sig outer digest and the user-signed digests: both sign under this domain.
 */
const HYPERLIQUID_SIGN_DOMAIN_SEPARATORS = new Map<number, Uint8Array>();

/** Domain separator of the `HyperliquidSignTransaction` domain for `chainId`; `verifyingContract` is the zero address. */
function hyperliquidSignDomainSeparator(chainId: number): Uint8Array {
  let separator = HYPERLIQUID_SIGN_DOMAIN_SEPARATORS.get(chainId);
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
    HYPERLIQUID_SIGN_DOMAIN_SEPARATORS.set(chainId, separator);
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
 * Reused struct/digest preimage buffers for {@linkcode createMultiSigDigestBytes}. Same reentrancy
 * contract as {@linkcode AGENT_STRUCT}: the function is synchronous, and a nested call gets its own
 * buffers so two digests never share storage mid-write.
 */
const MULTI_SIG_STRUCT = new Uint8Array(32 * 4);
const MULTI_SIG_DIGEST = new Uint8Array(2 + 32 + 32);
MULTI_SIG_DIGEST[0] = 0x19;
MULTI_SIG_DIGEST[1] = 0x01;
let MULTI_SIG_SCRATCH_BUSY = false;

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
  const nested = MULTI_SIG_SCRATCH_BUSY;
  const struct = nested ? new Uint8Array(32 * 4) : MULTI_SIG_STRUCT;
  const digest = nested ? new Uint8Array(2 + 32 + 32) : MULTI_SIG_DIGEST;
  MULTI_SIG_SCRATCH_BUSY = true;
  try {
    // Clear the nonce word: a previous call may have left high bytes set for a larger nonce.
    struct.fill(0, 96, 128);
    struct.set(SEND_MULTI_SIG_TYPEHASH, 0);
    struct.set(isTestnet ? HYPERLIQUID_CHAIN_HASH_TESTNET : HYPERLIQUID_CHAIN_HASH_MAINNET, 32);
    struct.set(multiSigActionHash, 64);
    // uint64(nonce) zero-padded to a 32-byte word, big-endian
    for (let i = 96 + 31, remaining = nonce; remaining > 0; i--, remaining = Math.floor(remaining / 256)) {
      struct[i] = remaining % 256;
    }
    const structHash = keccak256(struct);

    digest[0] = 0x19;
    digest[1] = 0x01;
    // `signatureChainId` is a `0x`-prefixed hex string, so radix 16 is the only correct base here:
    // radix 10 would parse it as `0` and silently sign under the wrong EIP-712 domain.
    digest.set(hyperliquidSignDomainSeparator(parseInt(signatureChainId, 16)), 2);
    digest.set(structHash, 34);
    return keccak256(digest);
  } finally {
    MULTI_SIG_SCRATCH_BUSY = nested;
  }
}

// --- User-signed action digests ----------------------------------------------

/** EIP-712 type definitions; the hash depends on key and field order. */
type TypedDataTypes = Record<string, readonly { name: string; type: string }[]>;

/** Primitive field kinds the hand-rolled user-signed encoder reproduces byte-identically. */
type UserSignedFieldKind = "string" | "bytes" | "address" | "bool" | "uint";

/**
 * Precomputed encoding plan for a `types` object: the primary type's typehash plus its field
 * descriptors. Everything else a digest needs — the domain separator and the `0x1901` envelope —
 * is shared with the multi-sig path.
 */
interface UserSignedPlan {
  typehash: Uint8Array;
  fields: readonly { name: string; kind: UserSignedFieldKind }[];
}

/**
 * Cache of encoding plans keyed by `types` object identity (`null` = unsupported shape, fall back
 * to the typed-data path). The `types` objects on the hot path are module constants
 * (`ApproveAgentTypes` and friends), so one compile serves every request.
 */
const USER_SIGNED_PLANS = new WeakMap<TypedDataTypes, UserSignedPlan | null>();

/** Maps an EIP-712 field type to a supported kind, or `undefined` for shapes left to viem. */
function userSignedFieldKind(type: string): UserSignedFieldKind | undefined {
  if (type === "string" || type === "bytes" || type === "address" || type === "bool") return type;
  // `uintN` with N a multiple of 8 up to 256 (bare `uint` is `uint256`). Anything else — fixed
  // `bytesN`, arrays, nested structs — falls back to the typed-data path.
  if (type === "uint") return "uint";
  const match = /^uint(\d+)$/.exec(type);
  if (match !== null) {
    const bits = Number(match[1]);
    if (bits >= 8 && bits <= 256 && bits % 8 === 0) return "uint";
  }
  return undefined;
}

/** Builds the encoding plan for `types`, or `null` when any field type is unsupported. */
function compileUserSignedPlan(types: TypedDataTypes): UserSignedPlan | null {
  const primaryType = Object.keys(types)[0];
  const typeFields = types[primaryType];
  if (typeFields === undefined) return null;
  const fields: { name: string; kind: UserSignedFieldKind }[] = [];
  for (const { name, type } of typeFields) {
    const kind = userSignedFieldKind(type);
    if (kind === undefined) return null;
    fields.push({ name, kind });
  }
  // No field references another struct (checked just above), so `encodeType` is the primary
  // type alone — there are no dependencies to append.
  const encodeType = `${primaryType}(${typeFields.map((f) => `${f.type} ${f.name}`).join(",")})`;
  return { typehash: keccak256(ENCODER.encode(encodeType)), fields };
}

/** Returns the cached plan for `types`, compiling (and caching `null`) on first sight. */
function userSignedPlan(types: TypedDataTypes): UserSignedPlan | null {
  let plan = USER_SIGNED_PLANS.get(types);
  if (plan === undefined) {
    plan = compileUserSignedPlan(types);
    USER_SIGNED_PLANS.set(types, plan);
  }
  return plan;
}

/** Decode one ASCII hex nibble; the caller already validated the character. */
function hexNibble(code: number): number {
  // '0'-'9' → 0-9; 'a'-'f' / 'A'-'F' → 10-15
  return code < 58 ? code - 48 : (code | 32) - 87;
}

/** Whether `code` is an ASCII hex digit of either case. */
function isHexCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70);
}

/** Whether `code` is a lowercase ASCII hex digit. */
function isLowerHexCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102);
}

/**
 * Decodes a dynamic `bytes` value (`0x` hex string or `Uint8Array`), or returns `undefined` to
 * fall back. Hex of either case is fine here — unlike addresses, `bytes` carries no checksum.
 */
function decodeDynamicBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (
    typeof value !== "string" ||
    value.length % 2 !== 0 ||
    value.charCodeAt(0) !== 48 ||
    (value.charCodeAt(1) | 32) !== 120
  ) {
    return undefined;
  }
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) {
    const hiCode = value.charCodeAt(2 + i * 2);
    const loCode = value.charCodeAt(3 + i * 2);
    if (!isHexCode(hiCode) || !isHexCode(loCode)) return undefined;
    bytes[i] = (hexNibble(hiCode) << 4) | hexNibble(loCode);
  }
  return bytes;
}

/**
 * Writes a 20-byte address into the low bytes of the zeroed word at `offset`, or returns `false`
 * to fall back. Mixed-case input falls back deliberately: viem checksum-validates it (and throws
 * on a bad checksum), so the typed-data path must keep that behavior and its error surface.
 */
function decodeAddressWord(word: Uint8Array, offset: number, value: unknown): boolean {
  if (
    typeof value !== "string" ||
    value.length !== 42 ||
    value.charCodeAt(0) !== 48 ||
    (value.charCodeAt(1) | 32) !== 120
  ) {
    return false;
  }
  for (let i = 0; i < 20; i++) {
    const hiCode = value.charCodeAt(2 + i * 2);
    const loCode = value.charCodeAt(3 + i * 2);
    if (!isLowerHexCode(hiCode) || !isLowerHexCode(loCode)) return false;
    word[offset + 12 + i] = (hexNibble(hiCode) << 4) | hexNibble(loCode);
  }
  return true;
}

/** Writes an unsigned integer into the zeroed 32-byte word at `offset`, or returns `false` to fall back. */
function encodeUintWord(word: Uint8Array, offset: number, value: unknown): boolean {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return false;
    // Big-endian over the low 7 bytes: `value / 256` and `value % 256` stay exact for every safe
    // integer, so the bytes match `BigInt(value)` bit for bit.
    for (let i = offset + 31, remaining = value; remaining > 0; i--, remaining = Math.floor(remaining / 256)) {
      word[i] = remaining % 256;
    }
    return true;
  }
  if (typeof value === "bigint") {
    if (value < 0n || value >= 1n << 256n) return false;
    for (let i = offset + 31, remaining = value; remaining > 0n; i--, remaining /= 256n) {
      word[i] = Number(remaining % 256n);
    }
    return true;
  }
  return false;
}

/**
 * Encodes one declared field into its 32-byte word. Returns `false` when the value is missing or
 * shaped in a way the encoder does not reproduce exactly (viem would throw for some of these; the
 * fallback preserves that error surface).
 */
function encodeUserSignedField(word: Uint8Array, offset: number, kind: UserSignedFieldKind, value: unknown): boolean {
  switch (kind) {
    case "string": {
      if (typeof value !== "string") return false;
      word.set(keccak256(ENCODER.encode(value)), offset);
      return true;
    }
    case "bytes": {
      const bytes = decodeDynamicBytes(value);
      if (bytes === undefined) return false;
      word.set(keccak256(bytes), offset);
      return true;
    }
    case "address":
      return decodeAddressWord(word, offset, value);
    case "bool": {
      if (value === true) word[offset + 31] = 1;
      else if (value !== false) return false;
      return true;
    }
    case "uint":
      return encodeUintWord(word, offset, value);
  }
}

/**
 * Computes the EIP-712 digest of a user-signed action in the `HyperliquidSignTransaction` domain,
 * or `undefined` when the shape is unsupported — the caller then falls back to the generic
 * typed-data path, so behavior (including errors) is unchanged for anything this encoder does not
 * cover.
 *
 * `digest = keccak256(0x1901 ‖ domainSeparator(signatureChainId) ‖ keccak256(typehash ‖ fields…))`
 *
 * Fields not declared in `types` are ignored, exactly like the message filtering the typed-data
 * path applies before encoding. Package-internal — not re-exported from `mod.ts`.
 *
 * @param action The action to hash; declared fields are read by name.
 * @param types The EIP-712 types of the action (hash depends on key and field order).
 * @param signatureChainId Chain ID of the EIP-712 domain, as a `0x`-prefixed hex string.
 * @return The 32-byte digest, byte-identical to viem's `hashTypedData`, or `undefined`.
 */
export function createUserSignedDigestBytes(
  action: Record<string, unknown>,
  types: TypedDataTypes,
  signatureChainId: `0x${string}`,
): Uint8Array | undefined {
  const plan = userSignedPlan(types);
  if (plan === null) return undefined;

  // `signatureChainId` is a `0x`-prefixed hex string, so radix 16 is the only correct base here:
  // radix 10 would parse it as `0` and silently sign under the wrong EIP-712 domain. A value that
  // does not parse to a safe non-negative integer falls back to the typed-data path: viem rejects
  // it there, while the hand-rolled domain separator would silently sign under the wrong domain.
  const chainId = parseInt(signatureChainId, 16);
  if (!Number.isSafeInteger(chainId) || chainId < 0) return undefined;

  // Every field encodes to exactly one 32-byte word (dynamic values contribute their keccak
  // hash), so the struct preimage size is fixed by the plan.
  const struct = new Uint8Array(32 * (1 + plan.fields.length));
  struct.set(plan.typehash, 0);
  let offset = 32;
  for (const field of plan.fields) {
    if (!encodeUserSignedField(struct, offset, field.kind, action[field.name])) return undefined;
    offset += 32;
  }
  const structHash = keccak256(struct);

  const digest = new Uint8Array(2 + 32 + 32);
  digest[0] = 0x19;
  digest[1] = 0x01;
  digest.set(hyperliquidSignDomainSeparator(chainId), 2);
  digest.set(structHash, 34);
  return keccak256(digest);
}
