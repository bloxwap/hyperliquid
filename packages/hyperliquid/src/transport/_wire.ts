/** JSON fragment reuse for SDK-owned bulk actions. Never inspect unregistered caller inputs. @module */

interface ActionEntry {
  json?: string;
  weight?: number;
}
const actions = new WeakMap<object, ActionEntry>();
const requests = new WeakMap<object, { action: object; signature: object; entry: ActionEntry }>();
/** Optional billing result, populated only when registered wire serialization succeeds. */
export interface ExchangeWireWeight {
  weight?: number;
}

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
 * @param billing Optional weight hint for rate-limited HTTP requests.
 * @return Its exact native JSON form, or undefined to request normal JSON.stringify.
 */
export function exchangeWireJSON(payload: unknown, billing?: ExchangeWireWeight): string | undefined {
  if (billing !== undefined) billing.weight = undefined;
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
  if (billing !== undefined) {
    // The serializer proved that the entire immutable tree is owned plain data. Walk
    // it once, preserving the no-parse fast path, and reuse its weight with the fragment.
    billing.weight = record.entry.weight ??= exchangeWeight({ action: record.action });
  }
  return metadataJSON === "{}" ? `{"action":${actionJSON}}` : `{"action":${actionJSON},${metadataJSON.slice(1)}`;
}

/**
 * Exchange weight: `1 + floor(batchLength / 40)`, where the docs define `batchLength` as "the
 * length of the array in the action" (a batched order request is their example). The confirmed
 * batch arrays are `orders` (order), `cancels` (cancel / cancelByCloid) and `modifies`
 * (batchModify), but the docs never close the set, so the batch length here is the LONGEST array
 * found anywhere in the action at any depth — which also bills the deployer arrays (`spotDeploy`
 * genesis tuples, `perpDeploy` setter lists) and any future batch action. Over-billing only
 * throttles the client harder while under-billing risks the server limit (429s, ultimately an IP
 * ban), so the max is the conservative reading. Actions without arrays — or with only short ones
 * (`< 40` entries: fixed tuples, a single `twap` object carries no array at all,
 * `convertToMultiSigUser`'s wire-stringified `signers`) — cost the documented minimum of 1.
 *
 * @param payload The parsed wire request, or a guarded SDK-owned envelope.
 * @return Its conservative pre-send weight.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
 */
export function exchangeWeight(payload: unknown): number {
  const action = exchangeAction(payload);
  if (action === undefined) return 1;
  return 1 + Math.floor(maxArrayLength(action) / 40);
}

/** The length of the longest array found in `value` at any depth (0 when there is none). */
function maxArrayLength(value: unknown): number {
  if (Array.isArray(value)) {
    let max = value.length;
    for (const item of value) max = Math.max(max, maxArrayLength(item));
    return max;
  }
  if (isRecord(value)) {
    let max = 0;
    for (const key in value) max = Math.max(max, maxArrayLength(value[key]));
    return max;
  }
  return 0;
}

/**
 * The action carrying the batch: the payload's `action`, unwrapped one level for multi-sig.
 * Unwrapping also keeps the wrapper's `signatures` array — authentication material, not batch
 * items — out of the billing walk.
 */
function exchangeAction(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !isRecord(payload.action)) return undefined;
  return unwrapMultiSigAction(payload.action);
}

/**
 * Unwraps a multi-sig action one level: `{ type: "multiSig", signatures, payload: { ..., action } }`
 * yields the wrapped action; anything else is returned as-is.
 */
function unwrapMultiSigAction(action: Record<string, unknown>): Record<string, unknown> {
  if (action.type === "multiSig" && isRecord(action.payload) && isRecord(action.payload.action)) {
    return action.payload.action;
  }
  return action;
}

/** True when `value` is a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
