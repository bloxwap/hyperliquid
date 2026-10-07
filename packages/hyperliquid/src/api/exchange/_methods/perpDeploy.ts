import { canonicalAction, type CanonicalAction } from "../../../actions/_canonical.ts";
import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

import { Address, Decimal, Hex, UnsignedDecimal, UnsignedInteger } from "../../_schemas.ts";
import { CancelRequest } from "./cancel.ts";
import { OrderRequest } from "./order.ts";

/**
 * Deploying HIP-3 assets.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions
 */
export const PerpDeployRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Action to perform. */
    action: v.variant("type", [
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Parameters for registering a new perpetual asset (v2). */
        registerAsset2: v.object({
          /** Max gas in native token wei. If not provided, then uses current deploy auction price. */
          maxGas: v.nullable(UnsignedInteger),
          /** Contains new asset listing parameters. */
          assetRequest: v.object({
            /** Asset symbol for the new asset. */
            coin: v.string(),
            /** Number of decimal places for size. */
            szDecimals: UnsignedInteger,
            /** Initial oracle price for the asset. */
            oraclePx: UnsignedDecimal,
            /** Margin table identifier for risk management. */
            marginTableId: UnsignedInteger,
            /** `"strictIsolated"` does not allow withdrawing of isolated margin from open position. */
            marginMode: v.picklist(["strictIsolated", "noCross", "normal"]),
          }),
          /** DEX name. */
          dex: v.string(),
          /** Contains new dex parameters. */
          schema: v.nullable(
            v.object({
              /** Full name of the DEX. */
              fullName: v.string(),
              /** Collateral token index. */
              collateralToken: UnsignedInteger,
              /** User to update oracles. If not provided, then deployer is assumed to be oracle updater. */
              oracleUpdater: v.nullable(Address),
              /** Whether this is a HIP-3* venue (testnet only). Defaults to false. */
              isStar: v.optional(v.boolean()),
            }),
          ),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Parameters for registering a new perpetual asset. */
        registerAsset: v.object({
          /** Max gas in native token wei. If not provided, then uses current deploy auction price. */
          maxGas: v.nullable(UnsignedInteger),
          /** Contains new asset listing parameters. */
          assetRequest: v.object({
            /** Asset symbol for the new asset. */
            coin: v.string(),
            /** Number of decimal places for size. */
            szDecimals: UnsignedInteger,
            /** Initial oracle price for the asset. */
            oraclePx: UnsignedDecimal,
            /** Margin table identifier for risk management. */
            marginTableId: UnsignedInteger,
            /** Whether the asset can only be traded with isolated margin. */
            onlyIsolated: v.boolean(),
          }),
          /** DEX name. */
          dex: v.string(),
          /** Contains new dex parameters. */
          schema: v.nullable(
            v.object({
              /** Full name of the DEX. */
              fullName: v.string(),
              /** Collateral token index. */
              collateralToken: UnsignedInteger,
              /** User to update oracles. If not provided, then deployer is assumed to be oracle updater. */
              oracleUpdater: v.nullable(Address),
              /** Whether this is a HIP-3* venue (testnet only). Defaults to false. */
              isStar: v.optional(v.boolean()),
            }),
          ),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Parameters for setting oracle and mark prices for assets. */
        setOracle: v.object({
          /** DEX name. */
          dex: v.string(),
          /** A list (sorted by key) of asset and oracle prices. */
          oraclePxs: v.array(v.tuple([v.string(), UnsignedDecimal])),
          /** An outer list of inner lists (inner list sorted by key) of asset and mark prices. */
          markPxs: v.array(v.array(v.tuple([v.string(), UnsignedDecimal]))),
          /** A list (sorted by key) of asset and external prices which prevent sudden mark price deviations. */
          externalPerpPxs: v.array(v.tuple([v.string(), UnsignedDecimal])),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** A list (sorted by key) of asset and funding multiplier. */
        setFundingMultipliers: v.array(v.tuple([v.string(), UnsignedDecimal])),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** A list (sorted by key) of asset and 8-hour funding interest rate (between -0.01 and 0.01). */
        setFundingInterestRates: v.array(v.tuple([v.string(), Decimal])),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Sorted asset/clamp tuples. Funding clamps must be between 0 and 0.01. */
        setFundingClamps: v.array(
          v.tuple([
            v.string(),
            v.pipe(
              UnsignedDecimal,
              v.check((value) => Number(value) <= 0.01, "Funding clamp must be at most 0.01."),
            ),
          ]),
        ),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Sorted asset/fee tuples. Scale is [0, 3], or [0, 10) with growth mode. */
        setDeployerFees: v.array(
          v.tuple([
            v.string(),
            v.pipe(
              v.object({
                /** Deployer fee scale. */
                scale: UnsignedDecimal,
                /** Whether growth mode is enabled. */
                growthMode: v.boolean(),
              }),
              v.check(
                (fees) => (fees.growthMode ? Number(fees.scale) < 10 : Number(fees.scale) <= 3),
                "Fee scale exceeds the range for this growth mode.",
              ),
            ),
          ]),
        ),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Parameters for halting or resuming trading for an asset. */
        haltTrading: v.object({
          /** Asset symbol for the asset to halt or resume. */
          coin: v.string(),
          /** Whether trading should be halted (true) or resumed (false). */
          isHalted: v.boolean(),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** A list (sorted by key) of asset and margin table ids. */
        setMarginTableIds: v.array(v.tuple([v.string(), UnsignedInteger])),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Parameters for inserting a margin table into a dex. */
        insertMarginTable: v.object({
          /** DEX name. */
          dex: v.string(),
          /** Margin table to insert. */
          marginTable: v.object({
            /** Description of the margin table. */
            description: v.string(),
            /**
             * Margin tiers, sorted by increasing lower bound and decreasing max leverage.
             * A maximum of 3 tiers is allowed.
             */
            marginTiers: v.pipe(
              v.array(
                v.object({
                  /** Position notional value above which leverage is constrained by `maxLeverage`. */
                  lowerBound: UnsignedInteger,
                  /** Maximum leverage (between `1` and `50`). */
                  maxLeverage: v.pipe(UnsignedInteger, v.minValue(1), v.maxValue(50)),
                }),
              ),
              v.maxLength(3),
            ),
          }),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Parameters for setting the fee recipient. */
        setFeeRecipient: v.object({
          /** DEX name. */
          dex: v.string(),
          /** Address of the fee recipient. */
          feeRecipient: Address,
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** A list (sorted by key) of asset and open interest cap notionals. */
        setOpenInterestCaps: v.array(v.tuple([v.string(), v.nullable(UnsignedInteger)])),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** A modification to sub-deployer permissions. */
        setSubDeployers: v.object({
          /** DEX name. */
          dex: v.string(),
          /** A modification to sub-deployer permissions. */
          subDeployers: v.array(
            v.object({
              /** Corresponds to a variant of PerpDeployAction. */
              variant: v.union([
                v.string(),
                v.object({
                  /** HIP-3* operation authorized by this grant (testnet only). */
                  hip3Star: v.picklist([
                    "modifyApproval",
                    "modifyBackstopLiquidatorApproval",
                    "setReduceOnly",
                    "cancel",
                    "cancelAll",
                    "order",
                    "sendAsset",
                    "setOracle",
                  ]),
                }),
              ]),
              /** Sub-deployer address. */
              user: Address,
              /** Add or remove the subDeployer from the authorized set for the action variant. */
              allowed: v.boolean(),
            }),
          ),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** A list (sorted by key) of asset and margin modes. */
        setMarginModes: v.array(v.tuple([v.string(), v.picklist(["strictIsolated", "noCross", "normal"])])),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Set fee scale. */
        setFeeScale: v.object({
          /** DEX name. */
          dex: v.string(),
          /** Fee scale (between 0.0 and 3.0). */
          scale: UnsignedDecimal,
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** A list (sorted by key) of asset and growth modes. */
        setGrowthModes: v.array(v.tuple([v.string(), v.boolean()])),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Parameters for setting a perp annotation. */
        setPerpAnnotation: v.object({
          /** Asset symbol for the asset to annotate. */
          coin: v.string(),
          /** Classification label (max 15 characters). */
          category: v.string(),
          /** Detailed description (max 400 characters). */
          description: v.string(),
          /** Display name for frontends to use instead of the L1 name, or null to ignore. */
          displayName: v.nullable(v.string()),
          /** Keywords used as hints to match against searches. */
          keywords: v.array(v.string()),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** HIP-3* venue operation (testnet only). */
        star: v.object({
          /** DEX name. */
          dex: v.string(),
          /** Oracle update or action proxied on behalf of an approved user. */
          operation: v.union([
            v.object({
              /** Spot oracle prices, sorted by asset symbol. */
              setOracle: v.object({
                /** Sorted asset/price tuples. */
                oraclePxs: v.array(v.tuple([v.string(), UnsignedDecimal])),
              }),
            }),
            v.object({
              /** User address and the operation applied to their account. */
              proxy: v.tuple([
                Address,
                v.union([
                  v.object({
                    /** Add/remove the user from the venue allowlist. */
                    modifyApproval: v.boolean(),
                  }),
                  v.object({
                    /** Allow/revoke deposits into the venue backstop liquidator. */
                    modifyBackstopLiquidatorApproval: v.boolean(),
                  }),
                  v.object({
                    /** Restrict/restore the user's trading to reduce-only actions. */
                    setReduceOnly: v.boolean(),
                  }),
                  v.object({
                    /** Standard cancellation payload without its action type. */
                    cancel: v.omit(CancelRequest.entries.action, ["type"]),
                  }),
                  v.object({
                    /** Cancel resting orders and TWAPs on this venue. */
                    cancelAll: v.object({
                      /** Restrict cancellation to 1-10 assets, or omit/use null for all. */
                      assets: v.optional(v.nullable(v.pipe(v.array(UnsignedInteger), v.minLength(1), v.maxLength(10)))),
                    }),
                  }),
                  v.object({
                    /** Standard order payload; every order must be reduce-only. */
                    order: v.pipe(
                      v.omit(OrderRequest.entries.action, ["type"]),
                      v.check(
                        (action) => action.orders.every((order) => order.r),
                        "Every proxied order must be reduce-only.",
                      ),
                    ),
                  }),
                  v.object({
                    /** Move collateral to another user on the same venue. */
                    sendAsset: v.object({
                      /** Recipient address. */
                      destination: Address,
                      /** Collateral amount. */
                      amount: UnsignedDecimal,
                    }),
                  }),
                ]),
              ]),
            }),
          ]),
        }),
      }),
      v.object({
        /** Type of action. */
        type: v.literal("perpDeploy"),
        /** Name of the perp dex to disable. */
        disableDex: v.string(),
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
export type PerpDeployRequest = v.InferOutput<typeof PerpDeployRequest>;

/**
 * Successful response without specific data or error response.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions
 */
export type PerpDeployResponse =
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
const PerpDeployActionSchema = /* @__PURE__ */ (() => {
  return v.variant("type", PerpDeployRequest.entries.action.options);
})();

/** Action parameters for the {@linkcode perpDeploy} function. */
export type PerpDeployParameters =
  v.InferInput<typeof PerpDeployActionSchema> extends infer T
    ? T extends unknown
      ? { [K in Exclude<keyof T, "type">]: T[K] }
      : never
    : never;

/** Request options for the {@linkcode perpDeploy} function. */
export type PerpDeployOptions = ExtractRequestOptions<v.InferInput<typeof PerpDeployRequest>>;

/** Successful variant of {@linkcode PerpDeployResponse} without errors. */
export type PerpDeploySuccessResponse = ExcludeErrorResponse<PerpDeployResponse>;

/**
 * Deploying HIP-3 assets.
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
 * import { perpDeploy } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * await perpDeploy({ transport, wallet }, {
 *   registerAsset: {
 *     maxGas: 1000000,
 *     assetRequest: {
 *       coin: "USDC",
 *       szDecimals: 8,
 *       oraclePx: "1",
 *       marginTableId: 1,
 *       onlyIsolated: false,
 *     },
 *     dex: "test",
 *     schema: null,
 *   },
 * });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions
 */
export function perpDeploy(
  config: ExchangeConfig,
  params: PerpDeployParameters,
  opts?: PerpDeployOptions,
): Promise<PerpDeploySuccessResponse> {
  const action = buildAction(PerpDeployActionSchema, { type: "perpDeploy", ...params }, opts);
  return executeL1Action(config, action, opts);
}

/**
 * Build a canonical {@linkcode perpDeploy} action: validate, normalize, fill defaults, and copy and freeze
 * the result. Allocates no nonce and makes no wallet or transport call, so the action can be signed
 * and submitted later, or reused while its fields stay valid.
 *
 * @param params Parameters specific to the API request.
 * @return Immutable action typed with {@link PerpDeploySuccessResponse}.
 *
 * @throws {ValidationError} When the request parameters fail validation.
 */
export function buildPerpDeploy(params: PerpDeployParameters): CanonicalAction<PerpDeploySuccessResponse> {
  const action = buildAction(PerpDeployActionSchema, { type: "perpDeploy", ...params });
  return canonicalAction(action, { kind: "l1" });
}
