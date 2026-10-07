/** Serialization reuse for SDK-owned immutable L1 actions. @module */
import type { L1Value, MsgpackWriter } from "./_msgpack.ts";
import { createKeccakPrefix } from "./_keccak.ts";

/** Weak ownership keeps both the payload and its encoded bytes collectable. */
const actions = new WeakMap<object, { bytes?: Uint8Array; hashTail?: (tail: Uint8Array) => Uint8Array }>();

/** Below two Keccak blocks, restoring state costs more than rehashing with WASM. */
const CHECKPOINT_MIN_BYTES = 272;

/**
 * Register only a recursively copied/frozen plain payload owned by an SDK builder.
 * A shallow Object.freeze on a caller's object does not establish this invariant.
 * No serialization is paid until the action is actually signed.
 */
export function registerImmutableL1Action(action: Readonly<Record<string, unknown>>): void {
  actions.set(action, {});
}

/**
 * Write an action at the beginning of a reset writer, or return a prefix hasher and leave
 * the writer empty for the fresh tail. Only a registered immutable payload reused after
 * its first hash can take the checkpoint path; small actions continue reusing bytes.
 * Ordinary public signing inputs are encoded on every call. Nonce, vault, expiry, digest,
 * and signature remain fresh on every execution.
 *
 * @param writer The reset preimage writer.
 * @param action The action to hash.
 * @return A checkpoint hasher when only the metadata tail should be written.
 */
export function writeL1Action(
  writer: MsgpackWriter,
  action: Record<string, unknown> | unknown[],
): ((tail: Uint8Array) => Uint8Array) | undefined {
  const entry = actions.get(action);
  if (entry?.bytes !== undefined) {
    if (entry.bytes.length >= CHECKPOINT_MIN_BYTES) {
      return (entry.hashTail ??= createKeccakPrefix(entry.bytes));
    }
    writer.raw(entry.bytes);
    return undefined;
  }
  writer.valueL1(action as L1Value);
  if (entry) entry.bytes = writer.view().slice();
  return undefined;
}
