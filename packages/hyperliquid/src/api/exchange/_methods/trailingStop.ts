import { canonicalAction, type CanonicalAction } from "../../../actions/_canonical.ts";
import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address, Hex, Percent, UnsignedDecimal, UnsignedInteger } from "../../_schemas.ts";

/**
 * Place a trailing stop order.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#place-a-trailing-stop-order
 */
export const TrailingStopRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Action to perform. */
    action: v.object({
      /** Type of action. */
      type: v.literal("trailingStop"),
      /** Asset ID. */
      asset: UnsignedInteger,
      /** Position side (`true` for long, `false` for short). */
      isBuy: v.boolean(),
      /** Size (in base currency units). */
      sz: UnsignedDecimal,
      /** Whether the order is reduce-only. */
      reduceOnly: v.boolean(),
      /** Retracement distance from the extreme price at which the stop triggers. */
      retracement: v.union([
        v.object({
          /** Retracement as a percentage of the price (e.g., "1.234%"). */
          pct: Percent,
        }),
        v.object({
          /** Retracement as an absolute price distance. */
          px: UnsignedDecimal,
        }),
      ]),
      /** Price at which the trailing stop activates (`null` to activate immediately). */
      activationPx: v.nullable(UnsignedDecimal),
    }),
    /** Nonce (timestamp in ms) used to prevent replay attacks. */
    nonce: UnsignedInteger,
    /** ECDSA signature components. */
    signature: v.object({
      /** First 32-byte component. */
      r: v.pipe(Hex, v.length(66)),
      /** Second 32-byte component. */
      s: v.pipe(Hex, v.length(66)),
      /** Recovery identifier. */
      v: v.picklist([27, 28]),
    }),
    /** Vault address (for vault trading). */
    vaultAddress: v.optional(Address),
    /** Expiration time of the action. */
    expiresAfter: v.optional(UnsignedInteger),
  });
})();
export type TrailingStopRequest = v.InferOutput<typeof TrailingStopRequest>;

/**
 * Response for placing a trailing stop order.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#place-a-trailing-stop-order
 */
export type TrailingStopResponse = {
  /** Successful status. */
  status: "ok";
  /** Response details. */
  response: {
    /** Type of response. */
    type: "trailingStop";
    /** Specific data. */
    data:
      | {
          /** Order ID of the placed trailing stop order. */
          oid: number;
        }
      | {
          /** Error message. */
          error: string;
        };
  };
};

// ============================================================
// Execution Logic
// ============================================================

import {
  type ExchangeConfig,
  type ExcludeErrorResponse,
  buildAction,
  executeL1Action,
  type ExtractRequestOptions,
} from "./_base/mod.ts";

/** Schema for action fields (excludes request-level system fields). */
const TrailingStopActionSchema = /* @__PURE__ */ (() => {
  return v.object(TrailingStopRequest.entries.action.entries);
})();

/** Action parameters for the {@linkcode trailingStop} function. */
export type TrailingStopParameters = Omit<v.InferInput<typeof TrailingStopActionSchema>, "type">;

/** Request options for the {@linkcode trailingStop} function. */
export type TrailingStopOptions = ExtractRequestOptions<v.InferInput<typeof TrailingStopRequest>>;

/** Successful variant of {@linkcode TrailingStopResponse} without errors. */
export type TrailingStopSuccessResponse = ExcludeErrorResponse<TrailingStopResponse>;

/**
 * Place a trailing stop order.
 *
 * Signing: L1 Action.
 *
 * @param config General configuration for Exchange API requests.
 * @param params Parameters specific to the API request.
 * @param opts Request execution options.
 * @return Successful variant of {@link TrailingStopResponse} without error status.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 * @throws {ApiRequestError} When the API returns an unsuccessful response.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { trailingStop } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await trailingStop({ transport, wallet }, {
 *   asset: 0,
 *   isBuy: true,
 *   sz: "0.1",
 *   reduceOnly: false,
 *   retracement: { pct: "1.234%" },
 *   activationPx: "30000",
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#place-a-trailing-stop-order
 */
export function trailingStop(
  config: ExchangeConfig,
  params: TrailingStopParameters,
  opts?: TrailingStopOptions,
): Promise<TrailingStopSuccessResponse> {
  const action = buildAction(TrailingStopActionSchema, { type: "trailingStop", ...params }, opts);
  return executeL1Action(config, action, opts);
}

/**
 * Build a canonical {@linkcode trailingStop} action: validate, normalize, fill defaults, and copy and freeze
 * the result. Allocates no nonce and makes no wallet or transport call, so the action can be signed
 * and submitted later, or reused while its fields stay valid.
 *
 * @param params Parameters specific to the API request.
 * @return Immutable action typed with {@link TrailingStopSuccessResponse}.
 *
 * @throws {ValidationError} When the request parameters fail validation.
 */
export function buildTrailingStop(params: TrailingStopParameters): CanonicalAction<TrailingStopSuccessResponse> {
  const action = buildAction(TrailingStopActionSchema, { type: "trailingStop", ...params });
  return canonicalAction(action, { kind: "l1" });
}
