/**
 * Shared error types for Hyperliquid API responses.
 * @module
 */

import { HyperliquidError } from "../_base.ts";

// ============================================================
// Error response shapes
// ============================================================

/** Top-level error response (`{ status: "err", response: string }`) returned when a request is rejected outright. */
export interface ApiTopLevelErrorResponse {
  /** Error status. */
  status: "err";
  /** Error message. */
  response: string;
}

/** Bulk-action error response where per-item statuses carry `{ error: string }` entries (e.g. `order`, `cancel`). */
export interface ApiBulkErrorResponse {
  /** Response details with per-item statuses. */
  response: {
    /** Type of response (e.g. `"order"`, `"cancel"`). */
    type: string;
    /** Specific data. */
    data: {
      /** Per-item statuses; failed items carry an error message. */
      statuses: unknown[];
    };
  };
}

/** Single-status error response (`response.data.status.error`), e.g. `twapOrder`, `twapCancel`. */
export interface ApiSingleErrorResponse {
  /** Response details. */
  response: {
    /** Specific data. */
    data: {
      /** Status carrying the error message. */
      status: { error: string };
    };
  };
}

/** Explorer endpoint error envelope (`{ type: "error", message }`). */
export interface ApiExplorerErrorResponse {
  /** Envelope type. */
  type: "error";
  /** Error message, when present. */
  message?: unknown;
}

/**
 * Raw API response attached to {@linkcode ApiRequestError}.
 *
 * The SDK only throws `ApiRequestError` after matching the response against one of these shapes,
 * so the union is exhaustive for SDK-thrown errors; the constructor still accepts `unknown` for
 * consumers building their own errors.
 */
export type ApiErrorResponse =
  | ApiTopLevelErrorResponse
  | ApiBulkErrorResponse
  | ApiSingleErrorResponse
  | ApiExplorerErrorResponse;

// ============================================================
// Error class
// ============================================================

/** Thrown when the API returns an error response. */
export class ApiRequestError extends HyperliquidError {
  /** Raw API response that contains the error. */
  readonly response: ApiErrorResponse;

  /**
   * @param response Raw API response that contains the error.
   * @param message Human-readable error message extracted from the response.
   */
  constructor(response: unknown, message?: string) {
    super(message ?? "An unknown error occurred while processing an API request. See `response` for more details.");
    this.name = "ApiRequestError";
    this.response = response as ApiErrorResponse;
  }
}
