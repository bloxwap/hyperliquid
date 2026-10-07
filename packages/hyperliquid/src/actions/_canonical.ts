/** Canonical action ownership and signing metadata. @module */
import { HyperliquidError } from "../_base.ts";
import { registerImmutableL1Action } from "../signing/_l1Cache.ts";
import { registerImmutableWireAction } from "../transport/_wire.ts";

declare const responseType: unique symbol;
/** Validated, owned action. Construct through an operation builder, not a type assertion. */
export interface CanonicalAction<T> {
  /** Canonical wire fields, recursively immutable at runtime. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly [responseType]?: T;
}

/** Metadata kept outside the public action and wire payload. */
export interface ActionMetadata {
  kind: "l1" | "user";
  types?: Record<string, readonly { name: string; type: string }[]>;
  nonce?: number;
  toMultiSigPayloadAction?: (action: Readonly<Record<string, unknown>>) => Record<string, unknown>;
  toSinglePayloadAction?: (action: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}
const metadata = new WeakMap<object, ActionMetadata>();

/** Copy before freezing so callers retain ownership of their input; preserve key order. */
export function immutableCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy)) as T;
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      // Assignment is cheaper than defining each key; only `__proto__` needs an explicit own property.
      if (key === "__proto__") Object.defineProperty(copy, key, { value: immutableCopy(child), enumerable: true });
      else copy[key] = immutableCopy(child);
    }
    return Object.freeze(copy) as T;
  }
  return value;
}

/** Internal factory used by validated operation builders. */
export function canonicalAction<T>(payload: Record<string, unknown>, info: ActionMetadata): CanonicalAction<T> {
  const action = Object.freeze({ payload: immutableCopy(payload) });
  if (info.kind === "l1") registerImmutableL1Action(action.payload);
  registerImmutableWireAction(action.payload);
  metadata.set(action, { ...info, types: info.types ? immutableCopy(info.types) : undefined });
  return action;
}

/** Reject foreign or reconstructed objects; serialization does not preserve validation ownership. */
export function actionMetadata<T>(action: CanonicalAction<T>): ActionMetadata {
  const info = metadata.get(action);
  if (!info) throw new HyperliquidError("Expected an action produced by an SDK builder");
  return info;
}
