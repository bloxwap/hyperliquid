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
