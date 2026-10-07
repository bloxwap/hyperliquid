/** JSON fragment reuse for SDK-owned bulk actions. Never inspect unregistered caller inputs. @module */

interface ActionEntry {
  json?: string;
}
const actions = new WeakMap<object, ActionEntry>();
const requests = new WeakMap<object, { action: object; signature: object; entry: ActionEntry }>();
const keys = new Set(["action", "signature", "nonce", "vaultAddress", "expiresAfter"]);

/**
 * Register only a recursively copied/frozen builder payload. Small actions retain native
 * JSON.stringify; the descriptor checks pay off only when an action has a bulk array.
 * @param action The SDK-owned immutable action.
 */
export function registerImmutableWireAction(action: Readonly<Record<string, unknown>>): void {
  if (Object.values(action).some((value) => Array.isArray(value) && value.length >= 8)) {
    actions.set(action, {});
  }
}

/**
 * Register an envelope constructed by the execution shell, without freezing or changing it.
 * The serializer rechecks its descriptors and action identity because prepared requests and
 * custom transports may mutate it later. Arbitrary public transport inputs remain unregistered.
 * @param request The shell's plain request object.
 * @param action The action the shell put into it.
 */
export function registerExchangeWireRequest(request: object, action: unknown): void {
  if (action === null || typeof action !== "object") return;
  const entry = actions.get(action);
  if (entry) {
    // The execution shell supplies the fresh, plain r/s/v object returned by the signer.
    const signature = Object.getOwnPropertyDescriptor(request, "signature")?.value;
    if (signature === null || typeof signature !== "object") return;
    requests.set(request, { action, signature, entry });
  }
}

/**
 * Serialize a registered bulk envelope, or decline without invoking any caller getter/toJSON.
 * Metadata and signatures are serialized fresh, keeping their nested toJSON key arguments.
 * The action fragment is safe to reuse because its entire tree is SDK-owned plain data.
 * Prototype toJSON hooks invalidate this optimization, including hooks on nested arrays.
 *
 * @param payload The exchange request to inspect.
 * @return Its exact native JSON form, or undefined to request normal JSON.stringify.
 */
export function exchangeWireJSON(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const record = requests.get(payload);
  if (record === undefined) return undefined;
  if (Object.getPrototypeOf(payload) !== Object.prototype || "toJSON" in payload || "toJSON" in Array.prototype)
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(payload);
  const names = Object.keys(payload);
  if (
    names[0] !== "action" ||
    descriptors.action?.value !== record.action ||
    descriptors.signature?.value !== record.signature
  )
    return undefined;
  const signature = record.signature;
  if (Object.getPrototypeOf(signature) !== Object.prototype || "toJSON" in signature) return undefined;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(signature))) {
    // An accessor or an object could run code during serialization that mutates a later
    // envelope field. Decline before invoking it, preserving native read order exactly.
    if (
      !("value" in descriptor) ||
      (descriptor.value !== null && typeof descriptor.value === "object") ||
      typeof descriptor.value === "function" ||
      typeof descriptor.value === "bigint"
    )
      return undefined;
  }
  const metadata: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!keys.has(name) || !("value" in descriptor)) return undefined;
    if (name !== "action") {
      if (
        name !== "signature" &&
        descriptor.value !== null &&
        (typeof descriptor.value === "object" ||
          typeof descriptor.value === "function" ||
          typeof descriptor.value === "bigint")
      )
        return undefined;
      metadata[name] = descriptor.value;
    }
  }
  // Both serializers operate on plain, data-only roots with no inherited toJSON.
  // Native JSON still handles escaping, omission, non-finite numbers, and signature fields.
  const actionJSON = (record.entry.json ??= JSON.stringify(record.action));
  const metadataJSON = JSON.stringify(metadata);
  return metadataJSON === "{}" ? `{"action":${actionJSON}}` : `{"action":${actionJSON},${metadataJSON.slice(1)}`;
}
