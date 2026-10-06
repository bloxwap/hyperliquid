import { canonicalAction, type CanonicalAction } from "../../../actions/_canonical.ts";
import * as v from "valibot";
import { Address, Hex, UnsignedDecimal, UnsignedInteger } from "../../_schemas.ts";

const FeeScale = v.pipe(
  UnsignedDecimal,
  v.check((value) => Number(value) <= 10, "Fee scale must be between 0 and 10"),
);

/** Venue-scoped HIP-4 deployment request (testnet-only). */
export const OutcomeDeployRequest = /* @__PURE__ */ (() =>
  v.object({
    /** Action to perform. */
    action: v.object({
      /** Type of action. */
      type: v.literal("outcomeDeploy"),
      /** Unique outcome venue name. */
      venue: v.pipe(v.string(), v.regex(/^[a-z]{2,4}$/)),
      /** Deployment or settlement operation. */
      operation: v.union([
        v.object({
          /** Deploy a standalone Yes/No market from a standalone outcome template. */
          registerStandaloneOutcomeFromTemplate: v.object({
            /** Template identifier. */
            id: v.string(),
            /** A list (sorted by key) of template keyword and value. */
            keywordToValue: v.array(v.tuple([v.string(), v.string()])),
            /** Deployer fee multiplier from 0 through 10. */
            deployerFeeScale: FeeScale,
          }),
        }),
        v.object({
          /** Deploy a question and its named outcomes. */
          registerQuestionFromTemplate: v.object({
            /** Instantiation of the question template. */
            questionTemplateInstance: v.object({
              /** Template identifier. */
              id: v.string(),
              /** A list (sorted by key) of template keyword and value. */
              keywordToValue: v.array(v.tuple([v.string(), v.string()])),
              /** Deployer fee multiplier from 0 through 10. */
              deployerFeeScale: FeeScale,
            }),
            /** Instantiations of the named outcome templates (at most 100). */
            namedOutcomeTemplateInstances: v.array(
              v.object({
                /** Template identifier. */
                id: v.string(),
                /** A list (sorted by key) of template keyword and value. */
                keywordToValue: v.array(v.tuple([v.string(), v.string()])),
              }),
            ),
          }),
        }),
        v.object({
          /** Settle one outcome of the deployer. */
          settleOutcome: v.object({
            /** Outcome identifier. */
            outcome: UnsignedInteger,
            /** Payout fraction of the Yes side (between 0 and 1). */
            settleFraction: UnsignedDecimal,
            /** Settlement details. Must be empty. */
            details: v.string(),
            /** Name and description of the outcome being settled. */
            nameAndDescription: v.tuple([v.string(), v.string()]),
            /** Names of the Yes and No sides of the outcome being settled. */
            sideNames: v.tuple([v.string(), v.string()]),
          }),
        }),
        v.object({
          /** Settle all remaining named outcomes of a question. */
          settleQuestion2: v.object({
            /** Question identifier. */
            question: UnsignedInteger,
            /** Settlement of each remaining active named outcome. */
            outcomeSettlements: v.array(
              v.object({
                /** Outcome identifier. */
                outcome: UnsignedInteger,
                /** Payout fraction of the Yes side (between 0 and 1). */
                settleFraction: UnsignedDecimal,
                /** Settlement details. Must be empty. */
                details: v.string(),
                /** Name and description of the outcome being settled. */
                nameAndDescription: v.tuple([v.string(), v.string()]),
                /** Names of the Yes and No sides of the outcome being settled. */
                sideNames: v.tuple([v.string(), v.string()]),
              }),
            ),
            /** Name and description of the question being settled. */
            nameAndDescription: v.tuple([v.string(), v.string()]),
          }),
        }),
        v.object({
          /** Add a named outcome to an existing template question. */
          registerAndAssociateNamedOutcomeFromTemplate: v.object({
            /** Question identifier. */
            question: UnsignedInteger,
            /** Named-outcome template instantiation. */
            namedOutcomeTemplateInstance: v.object({
              /** Template identifier. */
              id: v.string(),
              /** Sorted keyword/value tuples. */
              keywordToValue: v.array(v.tuple([v.string(), v.string()])),
            }),
          }),
        }),
        v.object({
          /** Grant or revoke permissions for this venue. */
          setSubDeployers: v.array(
            v.object({
              /** The settleQuestion grant authorizes settleQuestion2. */
              variant: v.picklist([
                "registerStandaloneOutcomeFromTemplate",
                "registerQuestionFromTemplate",
                "registerAndAssociateNamedOutcomeFromTemplate",
                "settleOutcome",
                "settleQuestion",
              ]),
              /** Authorized sub-deployer. */
              user: Address,
              /** Grant or revoke the permission. */
              allowed: v.boolean(),
            }),
          ),
        }),
      ]),
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
  }))();
export type OutcomeDeployRequest = v.InferOutput<typeof OutcomeDeployRequest>;

/** Outcome deployment response. */
export type OutcomeDeployResponse = import("./activateOutcomeDeployer.ts").ActivateOutcomeDeployerResponse;

import {
  type ExchangeConfig,
  type ExcludeErrorResponse,
  buildAction,
  executeL1Action,
  type ExtractRequestOptions,
} from "./_base/mod.ts";
const OutcomeDeployActionSchema = /* @__PURE__ */ (() => v.object(OutcomeDeployRequest.entries.action.entries))();
/** Parameters for outcome deployment. */
export type OutcomeDeployParameters = Omit<v.InferInput<typeof OutcomeDeployActionSchema>, "type">;
/** Request execution options. */
export type OutcomeDeployOptions = ExtractRequestOptions<v.InferInput<typeof OutcomeDeployRequest>>;
/** Successful outcome deployment response. */
export type OutcomeDeploySuccessResponse = ExcludeErrorResponse<OutcomeDeployResponse>;

/**
 * Deploy or settle outcomes for a venue (testnet-only).
 *
 * Signing: L1 Action. Keyword tuples must be sorted before signing.
 *
 * @param config General configuration for Exchange API requests.
 * @param params Parameters specific to the API request.
 * @param opts Request execution options.
 * @return Successful response without specific data.
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 * @throws {ApiRequestError} When the API returns an unsuccessful response.
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { outcomeDeploy } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 * await outcomeDeploy({ transport, wallet }, { venue: "ab", operation: { registerStandaloneOutcomeFromTemplate: { id: "abc", keywordToValue: [], deployerFeeScale: "1" } } });
 * ```
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions
 */
export function outcomeDeploy(
  config: ExchangeConfig,
  params: OutcomeDeployParameters,
  opts?: OutcomeDeployOptions,
): Promise<OutcomeDeploySuccessResponse> {
  return executeL1Action(
    config,
    buildAction(OutcomeDeployActionSchema, { type: "outcomeDeploy", ...params }, opts),
    opts,
  );
}

/**
 * Build a canonical {@linkcode outcomeDeploy} action: validate, normalize, fill defaults, and copy and freeze
 * the result. Allocates no nonce and makes no wallet or transport call, so the action can be signed
 * and submitted later, or reused while its fields stay valid.
 *
 * @param params Parameters specific to the API request.
 * @return Immutable action typed with {@link OutcomeDeploySuccessResponse}.
 *
 * @throws {ValidationError} When the request parameters fail validation.
 */
export function buildOutcomeDeploy(params: OutcomeDeployParameters): CanonicalAction<OutcomeDeploySuccessResponse> {
  const action = buildAction(OutcomeDeployActionSchema, { type: "outcomeDeploy", ...params });
  return canonicalAction(action, { kind: "l1" });
}
