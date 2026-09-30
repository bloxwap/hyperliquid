import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Hex, UnsignedInteger } from "../../_schemas.ts";

/**
 * Activate or deactivate the signer as an outcome deployer.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#activation
 */
export const ActivateOutcomeDeployerRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Action to perform. */
    action: v.union([
      v.object({
        /** Type of action. */
        type: v.literal("activateOutcomeDeployer"),
        /** Activate a unique outcome venue (testnet-only). */
        activate: v.object({
          /** Two to four lowercase ASCII letters. */
          venueName: v.pipe(v.string(), v.regex(/^[a-z]{2,4}$/)),
        }),
        /** Activation and deactivation are mutually exclusive. */
        deactivate: v.optional(v.never()),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("activateOutcomeDeployer"),
        /** Activation and deactivation are mutually exclusive. */
        activate: v.optional(v.never()),
        /** Permanently deactivate the outcome deployer. */
        deactivate: v.null(),
      }),
    ]),
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
    /** Expiration time of the action. */
    expiresAfter: v.optional(UnsignedInteger),
  });
})();
export type ActivateOutcomeDeployerRequest = v.InferOutput<typeof ActivateOutcomeDeployerRequest>;

/**
 * Successful response without specific data or error response.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#activation
 */
export type ActivateOutcomeDeployerResponse =
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

import {
  type ExchangeConfig,
  type ExcludeErrorResponse,
  buildAction,
  executeL1Action,
  type ExtractRequestOptions,
} from "./_base/mod.ts";

/** Schema for action fields (excludes request-level system fields). */
const ActivateOutcomeDeployerActionSchema = /* @__PURE__ */ (() => {
  return v.union(ActivateOutcomeDeployerRequest.entries.action.options);
})();

/** Action parameters for the {@linkcode activateOutcomeDeployer} function. */
export type ActivateOutcomeDeployerParameters =
  v.InferInput<typeof ActivateOutcomeDeployerActionSchema> extends infer T
    ? T extends unknown
      ? Omit<T, "type">
      : never
    : never;

/** Request options for the {@linkcode activateOutcomeDeployer} function. */
export type ActivateOutcomeDeployerOptions = ExtractRequestOptions<v.InferInput<typeof ActivateOutcomeDeployerRequest>>;

/** Successful variant of {@linkcode ActivateOutcomeDeployerResponse} without errors. */
export type ActivateOutcomeDeployerSuccessResponse = ExcludeErrorResponse<ActivateOutcomeDeployerResponse>;

/**
 * Activate or deactivate the signer as an outcome deployer.
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
 * import { activateOutcomeDeployer } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await activateOutcomeDeployer({ transport, wallet }, {
 *   activate: { venueName: "ab" },
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#activation
 */
export function activateOutcomeDeployer(
  config: ExchangeConfig,
  params: ActivateOutcomeDeployerParameters,
  opts?: ActivateOutcomeDeployerOptions,
): Promise<ActivateOutcomeDeployerSuccessResponse> {
  const action = buildAction(ActivateOutcomeDeployerActionSchema, { type: "activateOutcomeDeployer", ...params }, opts);
  return executeL1Action(config, action, opts);
}
