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
 * @param schema A valibot schema defining the canonical key order.
 * @param value The value whose keys should be reordered.
 * @return A new value with keys in schema-definition order.
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

  // Object → reorder keys by schema.entries
  if (t === "object" && isRecord(value)) {
    return reorderObject(schema.entries!, value);
  }

  // Array → canonicalize each item
  if (t === "array" && Array.isArray(value)) {
    return value.map((item) => walk(schema.item!, item));
  }

  // Tuple → canonicalize each item by index
  if (t === "tuple" && Array.isArray(value)) {
    return value.map((item, i) => walk(schema.items![i], item));
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
