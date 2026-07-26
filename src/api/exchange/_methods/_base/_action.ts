/**
 * Action construction for Exchange API methods: validate + canonicalize, with an opt-out.
 * @module
 */

import type * as v from "valibot";
import { parse } from "../../../../_base.ts";
import { canonicalize } from "../../../../signing/mod.ts";

/**
 * Builds the canonical wire action for an Exchange API method.
 *
 * Default path: validates and normalizes `input` against `schema` (valibot `parse`) and reorders
 * object keys into schema-declared order (`canonicalize`) — the two steps every exchange method
 * runs before signing.
 *
 * When `options.skipValidation` is `true`, both steps are skipped and `input` is trusted to
 * already be in canonical wire form. See the `skipValidation` option in `_config.ts` for the
 * contract this places on the caller.
 *
 * @param schema Valibot schema of the action (including the `type` field).
 * @param input Raw action input (`{ type, ...params }` as passed by the method).
 * @param options Request execution options (only `skipValidation` is read).
 * @return The action to sign and post.
 *
 * @throws {ValidationError} If validation is enabled and `input` fails the schema.
 */
export function buildAction<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
  options?: { skipValidation?: boolean },
): v.InferOutput<TSchema> {
  if (options?.skipValidation) return input as v.InferOutput<TSchema>;
  return canonicalize(schema, parse(schema, input));
}
