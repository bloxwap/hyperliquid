/**
 * Schema-driven key canonicalization for Hyperliquid action objects.
 * @module
 */

import type { GenericSchema } from "valibot";
import { HyperliquidError } from "../_base.ts";

/** Thrown when canonicalization fails due to schema/data key mismatch. */
export class CanonicalizeError extends HyperliquidError {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizeError";
  }
}

/**
 * Recursively rebuilds a value with object keys in schema-definition order.
 *
 * Subtrees already in schema order are returned by reference instead of being rebuilt, so
 * `canonicalize` over `v.parse` output — which valibot emits in schema-entry order — is a
 * verification walk with no allocation. The result may therefore alias the input; every exchange
 * method feeds it `parse` output that is never mutated afterwards.
 *
 * @param schema A valibot schema defining the canonical key order.
 * @param value The value whose keys should be reordered.
 * @return A value with keys in schema-definition order (the input itself when already canonical).
 *
 * @throws {CanonicalizeError} If keys in data don't match the schema.
 *
 * @example
 * ```ts
 * import { canonicalize } from "@bloxwap/hyperliquid/signing";
 * import { CancelRequest } from "@bloxwap/hyperliquid/api/exchange";
 *
 * const action = canonicalize(CancelRequest.entries.action, {
 *   type: "cancel",
 *   cancels: [{ a: 0, o: 12345 }],
 * });
 * ```
 */
export function canonicalize<T>(schema: GenericSchema, value: T): T {
  return walk(schema, value) as T;
}

// ============================================================
// Internal schema interface
// ============================================================

interface SchemaNode {
  readonly type: string;
  readonly entries?: Record<string, SchemaNode>;
  readonly wrapped?: SchemaNode;
  readonly item?: SchemaNode;
  readonly items?: readonly SchemaNode[];
  readonly key?: string;
  readonly options?: readonly SchemaNode[];
  readonly literal?: unknown;
}

// ============================================================
// Recursive walker
// ============================================================

function walk(schema: SchemaNode, value: unknown): unknown {
  const t = schema.type;

  // Unwrap optional / nullable / nullish
  if (t === "optional" || t === "nullable" || t === "nullish") {
    return value === null || value === undefined ? value : walk(schema.wrapped!, value);
  }

  // Object → reorder keys by schema.entries (a no-op rebuild is skipped: return the input)
  if (t === "object" && isRecord(value)) {
    return isCanonical(schema, value) ? value : reorderObject(schema.entries!, value);
  }

  // Array → canonicalize each item (skip the copy when every item is already canonical)
  if (t === "array" && Array.isArray(value)) {
    return isCanonical(schema, value) ? value : value.map((item) => walk(schema.item!, item));
  }

  // Tuple → canonicalize each item by index
  if (t === "tuple" && Array.isArray(value)) {
    return isCanonical(schema, value) ? value : value.map((item, i) => walk(schema.items![i], item));
  }

  // Variant → match option by discriminator + structural fallback
  if (t === "variant" && isRecord(value)) {
    const option = matchVariantOption(schema.key!, schema.options!, value);
    if (option) return walk(option, value);
    throw new CanonicalizeError(
      `No variant option matches data (discriminator "${schema.key}" = ${JSON.stringify(value[schema.key!])})`,
    );
  }

  // Union → match option structurally
  if (t === "union" && isRecord(value)) {
    const option = matchByStructure(schema.options!, value);
    if (option) return walk(option, value);
    return value;
  }

  // Primitives, literals, picklists, enums → return as-is
  return value;
}

/**
 * True when {@linkcode walk} would leave `value` unchanged — every object key already in schema
 * order, every value canonical — making the rebuild skippable without changing a single encoded
 * byte. Mirrors `walk`'s dispatch exactly, including its edge behavior:
 * - nodes `walk` passes through untouched (primitives, schema types it does not walk, unions with
 *   no structural match) are "canonical" by definition;
 * - nodes `walk` rejects (unknown or inherited data keys, missing required keys, unmatched
 *   variants, over-long tuples) are NOT, so the caller falls into the slow path and the same
 *   error (or `TypeError`) is raised from there.
 */
function isCanonical(schema: SchemaNode, value: unknown): boolean {
  const t = schema.type;

  // Unwrap optional / nullable / nullish
  if (t === "optional" || t === "nullable" || t === "nullish") {
    return value === null || value === undefined ? true : isCanonical(schema.wrapped!, value);
  }

  if (t === "object" && isRecord(value)) {
    return isCanonicalObject(schema.entries!, value);
  }

  if (t === "array" && Array.isArray(value)) {
    // Holes read as `undefined` here; every schema node treats `undefined` as canonical (walk
    // returns it as-is), which matches `Array.prototype.map` preserving the hole.
    for (let i = 0; i < value.length; i++) {
      if (!isCanonical(schema.item!, value[i])) return false;
    }
    return true;
  }

  if (t === "tuple" && Array.isArray(value)) {
    const items = schema.items!;
    // `walk` indexes `items[i]` unconditionally and dies on a missing schema — keep that on the
    // slow path rather than swallowing it.
    if (value.length > items.length) return false;
    for (let i = 0; i < value.length; i++) {
      if (!isCanonical(items[i], value[i])) return false;
    }
    return true;
  }

  if (t === "variant" && isRecord(value)) {
    const option = matchVariantOption(schema.key!, schema.options!, value);
    // No matching option → `walk` throws CanonicalizeError; route to the slow path for that.
    return option !== undefined && isCanonical(option, value);
  }

  if (t === "union" && isRecord(value)) {
    const option = matchByStructure(schema.options!, value);
    // No structural match → `walk` passes the value through whole, which is identity.
    return option === undefined || isCanonical(option, value);
  }

  return true;
}

/**
 * True when {@linkcode reorderObject} would rebuild `value` into an object with the same keys in
 * the same order and canonical values. Both sides iterate with `for...in` and go through the
 * engine's own key ordering (integer-like keys first), so the relative-order comparison is exact.
 * Returns false wherever reorderObject would throw instead, so the error still comes from there.
 */
function isCanonicalObject(entries: Record<string, SchemaNode>, value: Record<string, unknown>): boolean {
  const keys = schemaKeys(entries);

  // Every required schema key must be present (`in`, like reorderObject — inherited keys count).
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!(key in value)) {
      const t = entries[key].type;
      if (t !== "optional" && t !== "nullable" && t !== "nullish") return false;
    }
  }

  let position = 0;
  for (const key in value) {
    // An undeclared key makes reorderObject throw; an INHERITED declared key would be promoted to
    // an own key by the rebuild, which changes what `Object.keys` (and the encoder) sees — both
    // must take the slow path.
    if (!Object.hasOwn(entries, key) || !Object.hasOwn(value, key)) return false;
    let found = -1;
    for (let i = position; i < keys.length; i++) {
      if (keys[i] === key) {
        found = i;
        break;
      }
    }
    if (found === -1) return false; // keys present but not in schema order
    position = found + 1;
    if (!isCanonical(entries[key], value[key])) return false;
  }
  return true;
}

// ============================================================
// Helpers
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Schema key-order cache --------------------------------
// The canonical key order of an object node is a property of its schema, and schemas in this
// SDK are frozen module constants, so the key list is worth deriving exactly once. Without
// this, a 100-order batch calls `Object.keys` 201 times per `canonicalize` (1 root + 100
// orders + 100 `t` wrappers) and throws away 201 identical arrays. Weakly keyed so schemas
// built at runtime (and their key arrays) stay collectable.
const schemaKeyCache = new WeakMap<Record<string, SchemaNode>, readonly string[]>();

/** Returns the cached declaration-ordered key list of a schema's `entries`. */
function schemaKeys(entries: Record<string, SchemaNode>): readonly string[] {
  let keys = schemaKeyCache.get(entries);
  if (keys === undefined) {
    keys = Object.keys(entries);
    schemaKeyCache.set(entries, keys);
  }
  return keys;
}

function reorderObject(entries: Record<string, SchemaNode>, value: Record<string, unknown>): Record<string, unknown> {
  // --- Reject extra keys not in schema ---------------------
  for (const key in value) {
    // `hasOwn`, not `in`: a data key naming an `Object.prototype` member (`constructor`,
    // `toString`, …) would pass an `in` check via the prototype chain and be silently dropped.
    if (!Object.hasOwn(entries, key)) {
      throw new CanonicalizeError(`Key "${key}" exists in data but not in schema`);
    }
  }

  // --- Build reordered result (missing required keys are detected in the same pass)
  const keys = schemaKeys(entries);
  const result: Record<string, unknown> = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key in value) {
      result[key] = walk(entries[key], value[key]);
    } else {
      const t = entries[key].type;
      if (t !== "optional" && t !== "nullable" && t !== "nullish") {
        throw new CanonicalizeError(`Required key "${key}" exists in schema but not in data`);
      }
    }
  }
  return result;
}

function matchVariantOption(
  discriminatorKey: string,
  options: readonly SchemaNode[],
  value: Record<string, unknown>,
): SchemaNode | undefined {
  const discriminatorValue = value[discriminatorKey];

  // Track matches without an array: the common cases are 0 or 1 literal matches
  let firstMatch: SchemaNode | undefined;
  let extraMatches: SchemaNode[] | undefined;
  for (const option of options) {
    if (option.type === "object" && option.entries && discriminatorKey in option.entries) {
      const keySchema = option.entries[discriminatorKey];
      if (keySchema.type === "literal" && keySchema.literal === discriminatorValue) {
        if (firstMatch === undefined) {
          firstMatch = option;
        } else {
          (extraMatches ??= [firstMatch]).push(option);
        }
      }
    }
  }

  if (extraMatches === undefined) return firstMatch; // 0 or 1 match
  return matchByStructure(extraMatches, value); // ambiguous: disambiguate structurally
}

function matchByStructure(options: readonly SchemaNode[], value: Record<string, unknown>): SchemaNode | undefined {
  for (const option of options) {
    if (option.type !== "object" || !option.entries) continue;

    // Every data key must be declared in the option (`hasOwn` for the same
    // prototype-chain reason as in `reorderObject`)
    let allKnown = true;
    for (const key in value) {
      if (!Object.hasOwn(option.entries, key)) {
        allKnown = false;
        break;
      }
    }
    if (!allKnown) continue;

    // Every required option key must be present in data
    const optionEntries = option.entries;
    const optionKeys = schemaKeys(optionEntries);
    let allRequired = true;
    for (let i = 0; i < optionKeys.length; i++) {
      const key = optionKeys[i];
      if (key in value) continue;
      const t = optionEntries[key].type;
      if (t !== "optional" && t !== "nullable" && t !== "nullish") {
        allRequired = false;
        break;
      }
    }
    if (allRequired) return option;
  }

  return undefined;
}
