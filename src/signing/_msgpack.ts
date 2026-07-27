/**
 * Minimal MessagePack encoder for the L1 action-hash hot path.
 *
 * `@std/msgpack`'s `encode()` allocates one `Uint8Array` per scalar, per string header, per string body and
 * per container header, then concatenates the lot — over a thousand allocations plus a full copy for a
 * 100-order batch, which made it the dominant CPU cost of signing a batched action. This writer serializes
 * into a single grow-on-demand buffer instead.
 *
 * The output is **byte-for-byte identical to `@std/msgpack`**, including its non-canonical choices
 * (non-negative integers never use the signed forms, `bigint` is always a full 9 bytes, out-of-range
 * integers fall back to float64). That is not incidental: these bytes are hashed and signed, so a single
 * differing byte would produce a valid signature over a payload the user never authorized.
 * `tests/signing/msgpack.test.ts` pins the equivalence differentially against `@std/msgpack` itself.
 *
 * Supports exactly what Hyperliquid actions contain — string, integer (including the int64 widening that
 * `_l1.ts` performs via `BigInt`), float, boolean, null, `Uint8Array`, array and plain object.
 *
 * Two entry points share the buffer machinery:
 *
 * - {@linkcode MsgpackWriter.value} / {@linkcode encode}: the strict encoder described above.
 * - {@linkcode MsgpackWriter.valueL1}: the L1 action-hash entry, which applies the `_l1.ts` `adjust`
 *   normalization (dropped `undefined` properties, int64 widening, exotic-object rebuild) INLINE during
 *   the encode walk instead of as a separate tree pass. Its output is byte-for-byte identical to
 *   `value(adjust(x))` — pinned differentially by `tests/signing/fusedAdjust.test.ts` — not necessarily
 *   to `@std/msgpack` of the raw value.
 * @module
 */

/** Values this encoder accepts. Mirrors `@std/msgpack`'s `ValueType`, minus the types Hyperliquid never sends. */
export type MsgpackValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | Uint8Array
  | readonly MsgpackValue[]
  | { readonly [key: string]: MsgpackValue };

/**
 * Opaque marker wrapping a subtree that has already been through the L1 normalization (`preadjustL1Action`
 * in `_l1.ts`). {@linkcode MsgpackWriter.valueL1} unwraps it on sight and encodes the subtree with the
 * strict path: the normalization is idempotent, so the bytes are exactly what normalizing the raw subtree
 * inline would produce, without paying the per-node checks twice. Multi-sig hashes the same action in two
 * preimages, so the second hash reuses the marked subtree instead of re-walking it.
 *
 * Only meaningful inside L1 action-hash preimages — never place it in a wire payload.
 */
export class Adjusted {
  constructor(/** The adjusted subtree. */ readonly value: MsgpackValue) {}
}

/**
 * Input shape of {@linkcode MsgpackWriter.valueL1}. Superset of {@linkcode MsgpackValue}: the L1
 * normalization it applies inline also tolerates `undefined` properties (dropped), exotic objects such as
 * class instances and `Uint8Array` (encoded as maps of their own enumerable properties — the two-pass
 * `adjust` rebuilds those into plain objects before the strict encoder ever sees them), and
 * {@linkcode Adjusted} markers. The `Uint8Array` arm is intersected with a string index signature so the
 * shared map code indexes it without a cast — the same quirk `ValueType` in `_l1.ts` carries.
 */
export type L1Value =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Adjusted
  | (Uint8Array & { readonly [key: string]: L1Value })
  | readonly L1Value[]
  | { readonly [key: string]: L1Value };

const TEXT_ENCODER = new TextEncoder();
const BIGINT_INT64_MIN = -(2n ** 63n);
const BIGINT_UINT64_MAX = 2n ** 64n;

// --- Writer ----------------------------------------------------------------

/**
 * Single-buffer MessagePack writer.
 *
 * Intended to be allocated once and reused via {@linkcode MsgpackWriter.reset}: the buffer then grows to the
 * largest payload seen and stays there, so steady-state encoding allocates nothing. The trade-off is that one
 * oversized action keeps its buffer alive for the process's lifetime — acceptable, since actions are bounded
 * by what the exchange accepts in a single request.
 *
 * A writer is single-use at a time. {@linkcode MsgpackWriter.view} aliases the storage and is invalidated by
 * the next write, and a reused writer must not be handed a value whose getters can re-enter the same writer.
 */
export class MsgpackWriter {
  /** 1 KiB covers a single-order action without a grow; batches double up from there. */
  private buffer: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  private dataView: DataView<ArrayBuffer> = new DataView(this.buffer.buffer);
  private offset = 0;

  /** Rewinds to an empty payload, retaining the allocated storage. */
  reset(): void {
    this.offset = 0;
  }

  /**
   * Appends a MessagePack-encoded value.
   *
   * @param value The value to encode.
   * @throws {Error} If `value` contains a type MessagePack cannot represent, or a `bigint` outside 64 bits.
   */
  value(value: MsgpackValue): void {
    if (value === null) {
      this.byte(0xc0);
      return;
    }
    if (value === false) {
      this.byte(0xc2);
      return;
    }
    if (value === true) {
      this.byte(0xc3);
      return;
    }
    if (typeof value === "number") {
      this.number(value);
      return;
    }
    if (typeof value === "bigint") {
      this.bigint(value);
      return;
    }
    if (typeof value === "string") {
      this.string(value);
      return;
    }
    if (value instanceof Uint8Array) {
      this.binary(value);
      return;
    }
    if (Array.isArray(value)) {
      this.array(value);
      return;
    }
    if (typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (prototype === null || prototype === Object.prototype) {
        this.map(value as { readonly [key: string]: MsgpackValue });
        return;
      }
    }
    throw new Error("Cannot safely encode value into messagepack");
  }

  /**
   * Appends a MessagePack-encoded L1 action value, applying the `_l1.ts` `adjust` normalization INLINE —
   * one tree walk instead of `adjust`'s walk plus {@linkcode MsgpackWriter.value}'s walk. Byte-for-byte
   * identical to `value(adjust(x))` for every action shape:
   *
   * - `undefined` object properties are dropped, and the map header counts only the encoded entries
   * - safe integers too wide for the int32/uint32 forms widen to `bigint`, taking the 9-byte int64/uint64
   *   form instead of float64 (integral doubles beyond the safe-integer range still take float64)
   * - exotic objects (class instances, `Uint8Array`, …) encode as maps of their own enumerable properties —
   *   `adjust` rebuilds them into plain objects the strict encoder then maps; a `Uint8Array` in particular
   *   is a map of its index keys here, never the binary form {@linkcode MsgpackWriter.value} emits
   * - {@linkcode Adjusted} markers unwrap to their pre-normalized subtree, encoded with the strict path
   *
   * Only the L1 action-hash preimage uses this; the standalone {@linkcode encode} stays strict. Getters:
   * a consistent getter hashes identically to the two-pass path (each property is read once here versus
   * two or more times there); one that re-enters the hash is covered by the caller's re-entrancy guard,
   * exactly as before.
   *
   * @param value The value to encode.
   * @throws {Error} If `value` contains a type MessagePack cannot represent, or a `bigint` outside 64 bits.
   */
  valueL1(value: L1Value): void {
    if (value === null) {
      this.byte(0xc0);
      return;
    }
    if (value === false) {
      this.byte(0xc2);
      return;
    }
    if (value === true) {
      this.byte(0xc3);
      return;
    }
    if (typeof value === "number") {
      this.numberL1(value);
      return;
    }
    if (typeof value === "bigint") {
      this.bigint(value);
      return;
    }
    if (typeof value === "string") {
      this.string(value);
      return;
    }
    if (Array.isArray(value)) {
      this.arrayL1(value);
      return;
    }
    if (typeof value === "object") {
      if (value instanceof Adjusted) {
        // Pre-normalized subtree: no `undefined`s remain and wide integers are already `bigint`,
        // so the strict path reproduces the two-pass bytes with no per-node checks.
        this.value(value.value);
        return;
      }
      // `adjust` passes plain objects through and rebuilds every exotic one into a plain object; both
      // end up encoded as a map of their own enumerable keys, so the fused path maps them all. The
      // prototype only decides which `adjust` artifact the map must reproduce. (The cast only drops
      // the array arm `Array.isArray` cannot narrow out of a readonly tuple union.)
      const prototype = Object.getPrototypeOf(value);
      const map = value as { readonly [key: string]: L1Value };
      if (prototype === null || prototype === Object.prototype) {
        this.mapL1(map);
      } else {
        this.mapL1Exotic(map);
      }
      return;
    }
    // Unreachable for objects (handled above); this is `undefined` in an array or at the root, a
    // function, or a symbol — the two-pass path throws the same error on all of them.
    throw new Error("Cannot safely encode value into messagepack");
  }

  // --- Untagged appends ----------------------------------------------------
  // For callers that suffix non-MessagePack bytes onto the same buffer — the L1 hash preimage appends the
  // nonce, vault address and expiry after the encoded action.

  /**
   * Appends one raw byte, with no MessagePack tag.
   *
   * @param byte The byte to append; truncated to 8 bits, as `Uint8Array` assignment does.
   */
  byte(byte: number): void {
    this.ensure(1);
    this.buffer[this.offset++] = byte;
  }

  /**
   * Appends a big-endian unsigned 64-bit integer, with no MessagePack tag.
   *
   * @param value The value to append.
   * @throws {RangeError} If `value` does not fit in an unsigned 64-bit integer.
   */
  uint64(value: number | bigint): void {
    this.ensure(8);
    this.dataView.setBigUint64(this.offset, BigInt(value));
    this.offset += 8;
  }

  /**
   * Appends bytes verbatim, with no MessagePack header.
   *
   * @param bytes The bytes to append.
   */
  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  /**
   * A view of everything written since the last {@linkcode MsgpackWriter.reset}.
   *
   * @return A subarray aliasing the writer's storage — invalidated by the next write. Copy it to keep it.
   */
  view(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }

  // --- Internals -----------------------------------------------------------

  /** Grows the buffer so `additional` more bytes fit. Doubling keeps the number of copies logarithmic. */
  private ensure(additional: number): void {
    const required = this.offset + additional;
    if (required <= this.buffer.length) return;

    const buffer = new Uint8Array(Math.max(required, this.buffer.length * 2));
    buffer.set(this.buffer);
    this.buffer = buffer;
    this.dataView = new DataView(buffer.buffer);
  }

  /**
   * Mirrors `@std/msgpack`'s integer selection exactly, quirks included: non-negative values never take the
   * signed forms, and an integer too wide for int32/uint32 falls back to float64 rather than int64 — which is
   * precisely why `_l1.ts` pre-widens those to `bigint`. Do not "canonicalize" any of this; the bytes are signed.
   */
  private number(value: number): void {
    if (!Number.isInteger(value)) {
      this.float64(value);
      return;
    }
    if (value < 0) {
      if (value >= -32) {
        // Negative fixint: `Uint8Array` assignment supplies the two's-complement byte (-1 -> 0xff).
        this.byte(value);
      } else if (value >= -128) {
        this.ensure(2);
        this.buffer[this.offset] = 0xd0;
        this.dataView.setInt8(this.offset + 1, value);
        this.offset += 2;
      } else if (value >= -32768) {
        this.ensure(3);
        this.buffer[this.offset] = 0xd1;
        this.dataView.setInt16(this.offset + 1, value);
        this.offset += 3;
      } else if (value >= -2147483648) {
        this.ensure(5);
        this.buffer[this.offset] = 0xd2;
        this.dataView.setInt32(this.offset + 1, value);
        this.offset += 5;
      } else {
        this.float64(value);
      }
      return;
    }
    if (value <= 0x7f) {
      this.byte(value);
    } else if (value < 256) {
      this.ensure(2);
      this.buffer[this.offset] = 0xcc;
      this.buffer[this.offset + 1] = value;
      this.offset += 2;
    } else if (value < 65536) {
      this.ensure(3);
      this.buffer[this.offset] = 0xcd;
      this.dataView.setUint16(this.offset + 1, value);
      this.offset += 3;
    } else if (value < 4294967296) {
      this.ensure(5);
      this.buffer[this.offset] = 0xce;
      this.dataView.setUint32(this.offset + 1, value);
      this.offset += 5;
    } else {
      this.float64(value);
    }
  }

  private float64(value: number): void {
    this.ensure(9);
    this.buffer[this.offset] = 0xcb;
    this.dataView.setFloat64(this.offset + 1, value);
    this.offset += 9;
  }

  /**
   * Always emits the full 9-byte form, never a compact one — `@std/msgpack` does the same, so `0n` is
   * `cf 00 00 00 00 00 00 00 00` and not `00`. Error message matches the reference implementation verbatim.
   */
  private bigint(value: bigint): void {
    if (value < BIGINT_INT64_MIN || value >= BIGINT_UINT64_MAX) {
      throw new Error("Cannot safely encode bigint larger than 64 bits");
    }
    this.ensure(9);
    if (value < 0) {
      this.buffer[this.offset] = 0xd3;
      this.dataView.setBigInt64(this.offset + 1, value);
    } else {
      this.buffer[this.offset] = 0xcf;
      this.dataView.setBigUint64(this.offset + 1, value);
    }
    this.offset += 9;
  }

  /**
   * Nearly every string in a Hyperliquid action is short ASCII ("order", "Gtc", "30000", hex addresses), where
   * the UTF-8 length equals `.length` and the bytes are the char codes — so the header can be written before
   * the body with no `TextEncoder` round trip. Anything else defers to `TextEncoder` rather than hand-rolling
   * UTF-8, which also keeps lone-surrogate replacement identical to the reference implementation.
   */
  private string(value: string): void {
    let ascii = true;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 0x7f) {
        ascii = false;
        break;
      }
    }

    if (!ascii) {
      const bytes = TEXT_ENCODER.encode(value);
      this.stringHeader(bytes.length);
      this.raw(bytes);
      return;
    }

    this.stringHeader(value.length);
    this.ensure(value.length);
    for (let i = 0; i < value.length; i++) {
      this.buffer[this.offset + i] = value.charCodeAt(i);
    }
    this.offset += value.length;
  }

  private stringHeader(length: number): void {
    if (length < 32) {
      this.byte(0xa0 | length);
    } else if (length < 256) {
      this.ensure(2);
      this.buffer[this.offset] = 0xd9;
      this.buffer[this.offset + 1] = length;
      this.offset += 2;
    } else if (length < 65536) {
      this.ensure(3);
      this.buffer[this.offset] = 0xda;
      this.dataView.setUint16(this.offset + 1, length);
      this.offset += 3;
    } else if (length < 4294967296) {
      this.ensure(5);
      this.buffer[this.offset] = 0xdb;
      this.dataView.setUint32(this.offset + 1, length);
      this.offset += 5;
    } else {
      throw new Error("Cannot safely encode string with size larger than 32 bits");
    }
  }

  private binary(value: Uint8Array): void {
    if (value.length < 256) {
      this.ensure(2);
      this.buffer[this.offset] = 0xc4;
      this.buffer[this.offset + 1] = value.length;
      this.offset += 2;
    } else if (value.length < 65536) {
      this.ensure(3);
      this.buffer[this.offset] = 0xc5;
      this.dataView.setUint16(this.offset + 1, value.length);
      this.offset += 3;
    } else if (value.length < 4294967296) {
      this.ensure(5);
      this.buffer[this.offset] = 0xc6;
      this.dataView.setUint32(this.offset + 1, value.length);
      this.offset += 5;
    } else {
      throw new Error("Cannot safely encode Uint8Array with size larger than 32 bits");
    }
    this.raw(value);
  }

  private array(value: readonly MsgpackValue[]): void {
    if (value.length < 16) {
      this.byte(0x90 | value.length);
    } else if (value.length < 65536) {
      this.ensure(3);
      this.buffer[this.offset] = 0xdc;
      this.dataView.setUint16(this.offset + 1, value.length);
      this.offset += 3;
    } else if (value.length < 4294967296) {
      this.ensure(5);
      this.buffer[this.offset] = 0xdd;
      this.dataView.setUint32(this.offset + 1, value.length);
      this.offset += 5;
    } else {
      throw new Error("Cannot safely encode array with size larger than 32 bits");
    }
    for (const entry of value) {
      this.value(entry);
    }
  }

  /**
   * Key order is load-bearing — the exchange hashes the action, so `Object.keys` insertion order must be
   * preserved verbatim and never sorted. `Object.keys` also matches the reference implementation's own key
   * count, which ignores inherited enumerable properties.
   */
  private map(value: { readonly [key: string]: MsgpackValue }): void {
    const keys = Object.keys(value);
    if (keys.length < 16) {
      this.byte(0x80 | keys.length);
    } else if (keys.length < 65536) {
      this.ensure(3);
      this.buffer[this.offset] = 0xde;
      this.dataView.setUint16(this.offset + 1, keys.length);
      this.offset += 3;
    } else if (keys.length < 4294967296) {
      this.ensure(5);
      this.buffer[this.offset] = 0xdf;
      this.dataView.setUint32(this.offset + 1, keys.length);
      this.offset += 5;
    } else {
      throw new Error("Cannot safely encode map with size larger than 32 bits");
    }
    for (const key of keys) {
      this.string(key);
      this.value(value[key]);
    }
  }

  // --- L1 fused adjust+encode ------------------------------------------------
  // The {@linkcode MsgpackWriter.valueL1} internals. Every rule reproduces `adjust` (`_l1.ts`) exactly —
  // the two implementations must change together or not at all; `tests/signing/fusedAdjust.test.ts` pins
  // their byte-equality differentially.

  /**
   * `adjust`'s number rule, inline: safe integers too wide for the int32/uint32 forms widen to `bigint`
   * so they take the 9-byte int64/uint64 form; everything else — including integral doubles beyond the
   * safe-integer range, which python's msgpack emits as float64 — goes through the strict
   * {@linkcode MsgpackWriter.number} selection unchanged.
   */
  private numberL1(value: number): void {
    if (Number.isSafeInteger(value) && (value >= 0x100000000 || value < -0x80000000)) {
      this.bigint(BigInt(value));
      return;
    }
    this.number(value);
  }

  /**
   * Same header and element order as the strict {@linkcode MsgpackWriter.array} — `adjust` never changes
   * an array's length (holes are preserved) — with the normalization applied per element. A hole yields
   * `undefined` here and in the two-pass encoder alike, so both throw on it identically.
   */
  private arrayL1(value: readonly L1Value[]): void {
    const length = value.length;
    if (length < 16) {
      this.byte(0x90 | length);
    } else if (length < 65536) {
      this.ensure(3);
      this.buffer[this.offset] = 0xdc;
      this.dataView.setUint16(this.offset + 1, length);
      this.offset += 3;
    } else if (length < 4294967296) {
      this.ensure(5);
      this.buffer[this.offset] = 0xdd;
      this.dataView.setUint32(this.offset + 1, length);
      this.offset += 5;
    } else {
      throw new Error("Cannot safely encode array with size larger than 32 bits");
    }
    for (const entry of value) {
      this.valueL1(entry);
    }
  }

  /**
   * Fused map encoding for plain objects (the hot path — nearly every node of an action). `adjust`
   * returns such an object unchanged when nothing needs normalizing, so the two-pass header counts ALL
   * keys; only a rebuild (triggered by a dropped or changed entry) drops the `undefined` ones. The header
   * must still precede the entries, so this reserves header bytes sized for the full key set, encodes the
   * entries reading each property once, and backpatches the header when no key was dropped. The first
   * `undefined` entry rewinds to {@linkcode MsgpackWriter.mapL1Counted}, which knows its exact count up
   * front — the rare path, and the only one where the header can shrink below the reservation's form.
   */
  private mapL1(value: { readonly [key: string]: L1Value }): void {
    const keys = Object.keys(value);
    const length = keys.length;
    if (length >= 4294967296) {
      throw new Error("Cannot safely encode map with size larger than 32 bits");
    }
    const headerSize = length < 16 ? 1 : length < 65536 ? 3 : 5;
    this.ensure(headerSize);
    const headerAt = this.offset;
    this.offset += headerSize;
    for (const key of keys) {
      const entry = value[key];
      if (entry === undefined) {
        this.offset = headerAt;
        this.mapL1Counted(value, keys);
        return;
      }
      this.string(key);
      this.valueL1(entry);
    }
    if (headerSize === 1) {
      this.buffer[headerAt] = 0x80 | length;
    } else if (headerSize === 3) {
      this.buffer[headerAt] = 0xde;
      this.dataView.setUint16(headerAt + 1, length);
    } else {
      this.buffer[headerAt] = 0xdf;
      this.dataView.setUint32(headerAt + 1, length);
    }
  }

  /**
   * Fused map encoding for exotic objects (class instances, `Uint8Array`, …): `adjust` ALWAYS rebuilds
   * those into a plain object, so the two-pass bytes always come from the rebuilt key set — straight to
   * the counting path, no optimistic reservation.
   */
  private mapL1Exotic(value: { readonly [key: string]: L1Value }): void {
    const keys = Object.keys(value);
    if (keys.length >= 4294967296) {
      throw new Error("Cannot safely encode map with size larger than 32 bits");
    }
    this.mapL1Counted(value, keys);
  }

  /**
   * Counting counterpart of {@linkcode MsgpackWriter.mapL1}: the exact entry count is settled before the
   * header is written. Mirrors `adjust`'s rebuild, which drops `undefined` values and also own
   * `__proto__` data properties — assigning one onto the rebuilt plain object invokes the prototype
   * setter instead of creating an own property, so the two-pass encoder never emits it from a rebuild.
   * (A plain object that needs NO rebuild keeps an own `__proto__` key through `adjust`'s fast path, and
   * so does the optimistic path above.)
   */
  private mapL1Counted(value: { readonly [key: string]: L1Value }, keys: readonly string[]): void {
    let count = 0;
    for (const key of keys) {
      if (key !== "__proto__" && value[key] !== undefined) count++;
    }
    if (count < 16) {
      this.byte(0x80 | count);
    } else if (count < 65536) {
      this.ensure(3);
      this.buffer[this.offset] = 0xde;
      this.dataView.setUint16(this.offset + 1, count);
      this.offset += 3;
    } else {
      // `count <= keys.length`, which the caller already range-checked against 2^32.
      this.ensure(5);
      this.buffer[this.offset] = 0xdf;
      this.dataView.setUint32(this.offset + 1, count);
      this.offset += 5;
    }
    for (const key of keys) {
      if (key === "__proto__") continue;
      const entry = value[key];
      if (entry === undefined) continue;
      this.string(key);
      this.valueL1(entry);
    }
  }
}

/**
 * Encodes a value into an independent, exact-length MessagePack byte array.
 *
 * Allocates a fresh writer per call rather than reusing a module-level one: a getter on `value` could
 * re-enter this function, and two overlapping calls sharing one buffer would interleave their output.
 * Hot-path callers own a long-lived {@linkcode MsgpackWriter} instead and guard re-entrancy themselves.
 *
 * @param value The value to encode.
 * @return The encoded MessagePack bytes.
 * @throws {Error} If `value` contains a type MessagePack cannot represent, or a `bigint` outside 64 bits.
 */
export function encode(value: MsgpackValue): Uint8Array {
  const writer = new MsgpackWriter();
  writer.value(value);
  return writer.view().slice();
}
