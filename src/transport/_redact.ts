/**
 * Redaction helper for payloads copied into transport errors.
 *
 * Signed exchange payloads (`{ action, signature, nonce }`) are attached to
 * `HttpRequestError.request` and `WebSocketRequestError.request` so callers can see which
 * request failed. Forwarded to telemetry or logs, the raw signature would leak trading intent
 * (which market, which side, at what price — never keys: signatures are single-use), so the
 * transports replace it with a placeholder when the error is constructed. Multi-sig payloads nest
 * further signatures (`action.signatures`), and a WebSocket envelope nests the payload itself one
 * level down, so the redaction walks the whole payload — iteratively, with no depth limit, so a
 * pathologically deep payload can never overflow the call stack and mask the real error.
 * @module
 */

/** Placeholder that replaces every `signature`/`signatures` value when a payload is copied into an error. */
export const REDACTED_SIGNATURE = "0x<redacted>";

/** Placeholder for a reference that closes a reference cycle (see {@linkcode redactSignature}). */
const CIRCULAR_REFERENCE = "[Circular]";

/** Placeholder for a value whose `toJSON` threw (see {@linkcode redactSignature}). */
const UNSERIALIZABLE_VALUE = "[Unserializable]";

/**
 * The `request` of an error whose payload never produced a wire serialization.
 *
 * Transport errors carry the request as it went over the wire: a redacted snapshot of the exact
 * serialization the transport computed for sending. When that serialization itself failed (a
 * throwing getter/`toJSON`/proxy, a circular structure, an unserializable value), there is no
 * snapshot to redact — and the original is never traversed as a fallback, so error construction
 * can never mask the real cause. This constant is what remains.
 */
export const UNSERIALIZABLE_REQUEST = "[unserializable request]";

/** One node under traversal on the explicit stack. */
interface Frame {
  /** The object/array being walked (a `toJSON` output where applicable). */
  node: Record<string, unknown> | readonly unknown[];
  /** True for arrays, which are walked by index; {@linkcode keys} is then `null`. */
  isArray: boolean;
  /** Own-enumerable keys of {@linkcode node}; `null` for arrays. */
  keys: readonly string[] | null;
  /** Index of the next key/item to process. */
  index: number;
  /** The copy under construction; used only when {@linkcode changed} ends up true. */
  copy: Record<string, unknown> | unknown[];
  /** Whether any child differed from its original. */
  changed: boolean;
  /** The key this node sits under in its parent frame. */
  keyInParent: string | number;
  /** Objects added to the cycle path for this frame (the node plus any `toJSON` originals). */
  pathNodes: readonly object[];
}

/**
 * Returns `payload` unchanged unless the form `JSON.stringify` would produce from it carries a
 * `signature` or `signatures` key anywhere in its structure; in that case returns a copy with
 * every such value replaced by {@linkcode REDACTED_SIGNATURE} — a `signatures` array keeps its
 * length, each entry redacted.
 *
 * The traversal mirrors `JSON.stringify` semantics and never recurses:
 *
 * - An explicit stack walks objects/arrays of any depth — 50k nested wrappers cannot overflow it.
 * - `toJSON` is honored the way `JSON.stringify` honors it: invoked with the key the object sits
 *   under ("" at the root), and the OUTPUT is what gets walked, so secrets emitted only through
 *   `toJSON` are redacted too. A `toJSON` that throws yields a `"[Unserializable]"` marker
 *   instead of propagating — redaction must never mask the error being constructed.
 * - A reference already on the current path closes a cycle (impossible from `JSON.parse`, but
 *   possible in a hand-built payload) and is replaced with `"[Circular]"`; shared references off
 *   the path (diamonds) resolve to one shared result through a `WeakMap` memo.
 *
 * Redacted values are COPIES: the object actually sent to the server is never mutated, so the
 * wire keeps the real signatures. Payloads with nothing to redact pass through by reference,
 * which keeps the common info-request path allocation-free. Only own-enumerable keys are walked.
 */
export function redactSignature<T>(payload: T): T {
  if (typeof payload !== "object" || payload === null) return payload;

  const memo = new WeakMap<object, unknown>();
  const path = new WeakSet<object>();
  // A synthetic holder makes the root just another child: its processed value is the answer.
  const holder: Record<string, unknown> = { "": payload };
  path.add(holder);
  const rootFrame: Frame = {
    node: holder,
    isArray: false,
    keys: [""],
    index: 0,
    copy: {},
    changed: false,
    keyInParent: "",
    pathNodes: [holder],
  };
  const stack: Frame[] = [rootFrame];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const length = frame.isArray ? (frame.node as readonly unknown[]).length : frame.keys!.length;

    // --- Frame complete: settle the result into the parent frame ------------
    if (frame.index >= length) {
      const result = frame.changed ? frame.copy : frame.node;
      memo.set(frame.node, result);
      for (const pathNode of frame.pathNodes) path.delete(pathNode);
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent !== undefined) {
        assign(parent, frame.keyInParent, result);
        if (result !== frame.node) parent.changed = true;
      }
      continue;
    }

    // --- Next child ----------------------------------------------------------
    const key: string | number = frame.isArray ? frame.index : frame.keys![frame.index];
    frame.index++;
    const child: unknown = frame.isArray
      ? (frame.node as readonly unknown[])[key as number]
      : (frame.node as Record<string, unknown>)[key as string];

    // Signature keys are replaced inline, never traversed.
    if (!frame.isArray && key === "signature") {
      assign(frame, key, REDACTED_SIGNATURE);
      frame.changed = true;
      continue;
    }
    if (!frame.isArray && key === "signatures") {
      assign(frame, key, Array.isArray(child) ? child.map(() => REDACTED_SIGNATURE) : REDACTED_SIGNATURE);
      frame.changed = true;
      continue;
    }

    if (typeof child !== "object" || child === null) {
      assign(frame, key, child);
      continue;
    }

    // A reference already on the path closes a cycle.
    if (path.has(child)) {
      assign(frame, key, CIRCULAR_REFERENCE);
      frame.changed = true;
      continue;
    }

    // Diamonds reuse the settled result.
    const memoized = memo.get(child);
    if (memoized !== undefined) {
      assign(frame, key, memoized);
      if (memoized !== child) frame.changed = true;
      continue;
    }

    // `toJSON` decides the serialized form, so its output is what gets walked.
    let node = child as Record<string, unknown> | readonly unknown[];
    const pathNodes: object[] = [child];
    const toJSON = (child as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      // Adding the owner before invoking terminates a `toJSON` graph that mentions itself.
      path.add(child);
      let output: unknown;
      try {
        output = (toJSON as (key: string) => unknown).call(child, String(key));
      } catch {
        output = UNSERIALIZABLE_VALUE;
      }
      if (typeof output !== "object" || output === null) {
        assign(frame, key, output);
        frame.changed = true;
        path.delete(child);
        continue;
      }
      if (path.has(output)) {
        assign(frame, key, CIRCULAR_REFERENCE);
        frame.changed = true;
        path.delete(child);
        continue;
      }
      node = output as Record<string, unknown> | readonly unknown[];
      pathNodes.push(output);
      frame.changed = true; // the serialized form replaces the original child
    }

    // Descend.
    path.add(node);
    const isArray = Array.isArray(node);
    stack.push({
      node,
      isArray,
      keys: isArray ? null : Object.keys(node as Record<string, unknown>),
      index: 0,
      copy: isArray ? [] : {},
      changed: false,
      keyInParent: key,
      pathNodes,
    });
  }

  return (rootFrame.copy as Record<string, unknown>)[""] as T;
}

/** Writes a processed child into the frame's copy — array slot or object key, as appropriate. */
function assign(frame: Frame, key: string | number, value: unknown): void {
  if (frame.isArray) {
    (frame.copy as unknown[])[key as number] = value;
  } else if (key === "__proto__") {
    // Bracket assignment would retarget the copy's prototype instead of creating the own key.
    Object.defineProperty(frame.copy, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    (frame.copy as Record<string, unknown>)[key as string] = value;
  }
}
