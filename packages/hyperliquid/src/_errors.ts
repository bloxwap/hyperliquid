/** Dependency-free error identities shared by validation, signing, and transport entry points. */
import type * as v from "valibot";

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
