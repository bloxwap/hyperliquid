/**
 * Request options for Info API methods.
 * @module
 */

import type * as v from "valibot";
import { isAbortSignal, parse } from "../../../../_base.ts";

/** Options accepted by Info API methods in place of a bare `AbortSignal`. */
export interface InfoRequestOptions {
  /** {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request. */
  signal?: AbortSignal;

  /**
   * Opt-in escape hatch for trusted, performance-critical callers: skip request validation
   * (the valibot `parse` every info method runs on its parameters before sending).
   *
   * **Unsafe for untrusted input.** When `true`, the SDK performs no validation, normalization,
   * default-filling, or key reordering on the request parameters — they are posted exactly as
   * given. The caller must therefore supply parameters that are already in wire form:
   * - addresses and hex strings in lowercase;
   * - every value already of the exact type the schema outputs (e.g. a number where the schema
   *   accepts `number | string` and outputs a number).
   *
   * Invalid input on this path is rejected by the server instead of a client-side
   * `ValidationError` — detecting that drift is the cost of the saved microseconds.
   *
   * Default: `false` (validate).
   */
  skipValidation?: boolean;
}

/**
 * Normalizes an info method's trailing argument — a bare {@linkcode AbortSignal} or an
 * {@linkcode InfoRequestOptions} object — into its parts. The bare signal is detected
 * structurally ({@linkcode isAbortSignal}), so a signal from another realm or a polyfill is
 * never mistaken for an options object.
 *
 * @param signalOrOptions The trailing argument as the caller passed it.
 * @return The abort signal to forward to the transport, and whether validation was opted out of.
 */
export function infoOptions(signalOrOptions?: AbortSignal | InfoRequestOptions): {
  signal: AbortSignal | undefined;
  skipValidation: boolean;
} {
  if (isAbortSignal(signalOrOptions)) return { signal: signalOrOptions, skipValidation: false };
  return { signal: signalOrOptions?.signal, skipValidation: signalOrOptions?.skipValidation ?? false };
}

/**
 * Validates `input` against `schema`, or returns it untouched when the caller opted out via
 * {@linkcode InfoRequestOptions.skipValidation}. The cast on the skipped path is sound by the
 * option's own contract: the caller guarantees the parameters are already in wire form.
 *
 * @param schema The request schema the method validates against.
 * @param input The `{ type, ...params }` request object.
 * @param skipValidation `true` returns `input` as-is; `false`/absent runs the valibot parse.
 * @return The validated (or, when skipped, the verbatim) request object.
 *
 * @throws {ValidationError} When `input` fails validation and validation was not skipped.
 */
export function parseInfo<const TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  input: unknown,
  skipValidation?: boolean,
): v.InferOutput<TSchema> {
  if (skipValidation === true) return input as v.InferOutput<TSchema>;
  return parse(schema, input);
}
