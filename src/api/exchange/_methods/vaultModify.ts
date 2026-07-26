import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address, Hex, UnsignedInteger } from "../../_schemas.ts";

/**
 * Modify a vault's configuration.
 * @see null
 */
export const VaultModifyRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Action to perform. */
    action: v.object({
      /** Type of action. */
      type: v.literal("vaultModify"),
      /** Vault address. */
      vaultAddress: Address,
      /** Allow deposits from followers. */
      allowDeposits: v.nullish(v.boolean(), null),
      /** Always close positions on withdrawal. */
      alwaysCloseOnWithdraw: v.nullish(v.boolean(), null),
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
    /** Expiration time of the action. */
    expiresAfter: v.optional(UnsignedInteger),
  });
})();
export type VaultModifyRequest = v.InferOutput<typeof VaultModifyRequest>;

/**
 * Successful response without specific data or error response.
 * @see null
 */
export type VaultModifyResponse =
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
const VaultModifyActionSchema = /* @__PURE__ */ (() => {
  return v.object(VaultModifyRequest.entries.action.entries);
})();

/** Action parameters for the {@linkcode vaultModify} function. */
export type VaultModifyParameters = Omit<v.InferInput<typeof VaultModifyActionSchema>, "type">;

/** Request options for the {@linkcode vaultModify} function. */
export type VaultModifyOptions = ExtractRequestOptions<v.InferInput<typeof VaultModifyRequest>>;

/** Successful variant of {@linkcode VaultModifyResponse} without errors. */
export type VaultModifySuccessResponse = ExcludeErrorResponse<VaultModifyResponse>;

/**
 * Modify a vault's configuration.
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
 * import { vaultModify } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await vaultModify({ transport, wallet }, {
 *   vaultAddress: "0x...",
 *   allowDeposits: true,
 *   alwaysCloseOnWithdraw: false,
 * });
 * ```
 *
 * @see null
 */
export function vaultModify(
  config: ExchangeConfig,
  params: VaultModifyParameters,
  opts?: VaultModifyOptions,
): Promise<VaultModifySuccessResponse> {
  const action = buildAction(VaultModifyActionSchema, { type: "vaultModify", ...params }, opts);
  return executeL1Action(config, action, opts);
}
