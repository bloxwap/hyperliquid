import * as v from "valibot";

/** Base error class for all SDK errors. */
export class HyperliquidError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HyperliquidError";
  }
}

/** Thrown when request parameters fail schema validation. */
export class ValidationError extends HyperliquidError {
  override cause: v.ValiError<v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>;
  constructor(message: string, options: { cause: v.ValiError<v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>> }) {
    super(message, options);
    this.name = "ValidationError";
    this.cause = options.cause;
  }
}

/**
 * Returns true when `value` quacks like an {@linkcode AbortSignal}.
 *
 * Overloads that accept `params | signal` cannot discriminate with `instanceof AbortSignal`:
 * a signal created in another realm (iframe, worker, `vm` context) or by a polyfill fails the
 * check and would be treated as params. The structural test — a boolean `aborted` and a function
 * `addEventListener` — accepts any signal-like object regardless of its realm or prototype.
 */
export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AbortSignal).aborted === "boolean" &&
    typeof (value as AbortSignal).addEventListener === "function"
  );
}

/** Wrapper around `v.parse` that throws {@linkcode ValidationError} instead of `ValiError`. */
export function parse<const TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  input: unknown,
): v.InferOutput<TSchema> {
  try {
    return v.parse(schema, input);
  } catch (error) {
    const valiError = error as v.ValiError<typeof schema>;
    throw new ValidationError(v.summarize(valiError.issues), { cause: valiError });
  }
}
