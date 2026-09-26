import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address, Hex, UnsignedInteger } from "../../_schemas.ts";

/**
 * Schedule a cancel-all operation at a future time.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#schedule-cancel-dead-mans-switch
 */
export const ScheduleCancelRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Action to perform. */
    action: v.object({
      /** Type of action. */
      type: v.literal("scheduleCancel"),
      /**
       * Scheduled time (in ms since epoch).
       * Must be at least 5 seconds in the future.
       *
       * If not specified, will cause all scheduled cancel operations to be deleted.
       */
      time: v.optional(UnsignedInteger),
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
export type ScheduleCancelRequest = v.InferOutput<typeof ScheduleCancelRequest>;

/**
 * Successful response without specific data or error response.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#schedule-cancel-dead-mans-switch
 */
export type ScheduleCancelResponse =
  | {
      /** Successful status. */
      status: "ok";
      /** Response details. */
      response: {
        /** Type of response. */
        type: "default";
      };
    }
  | {
      /** Error status. */
      status: "err";
      /** Error message. */
      response: string;
    };

// ============================================================
// Execution Logic
// ============================================================

import { parse } from "../../../_base.ts";
import {
  type ExchangeConfig,
  type ExcludeErrorResponse,
  buildAction,
  executeL1Action,
  type ExtractRequestOptions,
} from "./_base/mod.ts";

/** Schema for action fields (excludes request-level system fields). */
const ScheduleCancelActionSchema = /* @__PURE__ */ (() => {
  return v.object(ScheduleCancelRequest.entries.action.entries);
})();

/** Minimum lead time for a scheduled cancel: 5 seconds, per the API docs. */
const MIN_SCHEDULE_LEAD_MS = 5_000;

/**
 * Schema enforcing the documented "at least 5 seconds in the future" constraint on `time`.
 * Kept out of {@linkcode ScheduleCancelRequest}: the check reads `Date.now()` at call time, which
 * would make the shared request schema non-deterministic for validating recorded payloads.
 */
const ScheduleCancelTimeSchema = /* @__PURE__ */ (() => {
  return v.pipe(
    UnsignedInteger,
    v.check(
      (input) => input >= Date.now() + MIN_SCHEDULE_LEAD_MS,
      "Scheduled time must be at least 5 seconds in the future",
    ),
  );
})();

/** Action parameters for the {@linkcode scheduleCancel} function. */
export type ScheduleCancelParameters = Omit<v.InferInput<typeof ScheduleCancelActionSchema>, "type" | "time"> & {
  /**
   * Scheduled time (in ms since epoch).
   * Must be at least 5 seconds in the future.
   *
   * `null` is treated as unset (python SDK parity): all scheduled cancel operations are deleted.
   */
  time?: v.InferInput<typeof UnsignedInteger> | null;
};

/** Request options for the {@linkcode scheduleCancel} function. */
export type ScheduleCancelOptions = ExtractRequestOptions<v.InferInput<typeof ScheduleCancelRequest>>;

/** Successful variant of {@linkcode ScheduleCancelResponse} without errors. */
export type ScheduleCancelSuccessResponse = ExcludeErrorResponse<ScheduleCancelResponse>;

/**
 * Schedule a cancel-all operation at a future time.
 *
 * Signing: L1 Action.
 *
 * @param config General configuration for Exchange API requests.
 * @param params Parameters specific to the API request.
 * @param opts Request execution options.
 * @return Successful response without specific data.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 * @throws {ApiRequestError} When the API returns an unsuccessful response.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { scheduleCancel } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await scheduleCancel({ transport, wallet }, {
 *   time: Date.now() + 10_000,
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#schedule-cancel-dead-mans-switch
 */
export function scheduleCancel(
  config: ExchangeConfig,
  params?: ScheduleCancelParameters,
  opts?: ScheduleCancelOptions,
): Promise<ScheduleCancelSuccessResponse>;
export function scheduleCancel(
  config: ExchangeConfig,
  opts?: ScheduleCancelOptions,
): Promise<ScheduleCancelSuccessResponse>;
export function scheduleCancel(
  config: ExchangeConfig,
  paramsOrOpts?: ScheduleCancelParameters | ScheduleCancelOptions,
  maybeOpts?: ScheduleCancelOptions,
): Promise<ScheduleCancelSuccessResponse> {
  const isFirstArgParams = paramsOrOpts && "time" in paramsOrOpts;
  const params = isFirstArgParams ? paramsOrOpts : {};
  const opts = isFirstArgParams ? maybeOpts : (paramsOrOpts as ScheduleCancelOptions);

  const actionInput: Record<string, unknown> = { type: "scheduleCancel", ...params };
  // Python SDK parity: `time: null` means "unset" — the key is dropped from the posted action,
  // which deletes all scheduled cancel operations.
  if (actionInput.time === null) delete actionInput.time;

  // Docs: the scheduled time must be at least 5 seconds in the future. Cheap deterministic guard,
  // checked against `Date.now()` at call time; runs even when `skipValidation` is set.
  if (actionInput.time !== undefined) parse(ScheduleCancelTimeSchema, actionInput.time);

  const action = buildAction(ScheduleCancelActionSchema, actionInput, opts);
  return executeL1Action(config, action, opts);
}
