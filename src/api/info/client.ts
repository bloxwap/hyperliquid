/**
 * Client for the Hyperliquid Info API endpoint.
 * @module
 */

import { isAbortSignal, type InfoConfig, type PaginationOptions } from "./_methods/_base/mod.ts";

// ============================================================
// Methods Imports
// ============================================================

import {
  activeAssetData,
  type ActiveAssetDataParameters,
  type ActiveAssetDataResponse,
} from "./_methods/activeAssetData.ts";
import {
  allBorrowLendReserveStates,
  type AllBorrowLendReserveStatesResponse,
} from "./_methods/allBorrowLendReserveStates.ts";
import { allMids, type AllMidsParameters, type AllMidsResponse } from "./_methods/allMids.ts";
import { allPerpMetas, type AllPerpMetasResponse } from "./_methods/allPerpMetas.ts";
import {
  approvedBuilders,
  type ApprovedBuildersParameters,
  type ApprovedBuildersResponse,
} from "./_methods/approvedBuilders.ts";
import {
  borrowLendReserveState,
  type BorrowLendReserveStateParameters,
  type BorrowLendReserveStateResponse,
} from "./_methods/borrowLendReserveState.ts";
import {
  borrowLendUserState,
  type BorrowLendUserStateParameters,
  type BorrowLendUserStateResponse,
} from "./_methods/borrowLendUserState.ts";
import {
  candleSnapshot,
  type CandleSnapshotParameters,
  type CandleSnapshotResponse,
} from "./_methods/candleSnapshot.ts";
import { candleSnapshotAll, type CandleSnapshotAllParameters } from "./_methods/candleSnapshotAll.ts";
import { candleSnapshotPages, type CandleSnapshotPagesParameters } from "./_methods/candleSnapshotPages.ts";
import {
  clearinghouseState,
  type ClearinghouseStateParameters,
  type ClearinghouseStateResponse,
} from "./_methods/clearinghouseState.ts";
import { delegations, type DelegationsParameters, type DelegationsResponse } from "./_methods/delegations.ts";
import {
  delegatorHistory,
  type DelegatorHistoryParameters,
  type DelegatorHistoryResponse,
} from "./_methods/delegatorHistory.ts";
import {
  delegatorRewards,
  type DelegatorRewardsParameters,
  type DelegatorRewardsResponse,
} from "./_methods/delegatorRewards.ts";
import {
  delegatorSummary,
  type DelegatorSummaryParameters,
  type DelegatorSummaryResponse,
} from "./_methods/delegatorSummary.ts";
import { exchangeStatus, type ExchangeStatusResponse } from "./_methods/exchangeStatus.ts";
import { extraAgents, type ExtraAgentsParameters, type ExtraAgentsResponse } from "./_methods/extraAgents.ts";
import {
  frontendOpenOrders,
  type FrontendOpenOrdersParameters,
  type FrontendOpenOrdersResponse,
} from "./_methods/frontendOpenOrders.ts";
import {
  fundingHistory,
  type FundingHistoryParameters,
  type FundingHistoryResponse,
} from "./_methods/fundingHistory.ts";
import { fundingHistoryAll, type FundingHistoryAllParameters } from "./_methods/fundingHistoryAll.ts";
import { fundingHistoryPages, type FundingHistoryPagesParameters } from "./_methods/fundingHistoryPages.ts";
import {
  gossipPriorityAuctionStatus,
  type GossipPriorityAuctionStatusResponse,
} from "./_methods/gossipPriorityAuctionStatus.ts";
import { gossipRootIps, type GossipRootIpsResponse } from "./_methods/gossipRootIps.ts";
import {
  historicalOrders,
  type HistoricalOrdersParameters,
  type HistoricalOrdersResponse,
} from "./_methods/historicalOrders.ts";
import { isVip, type IsVipParameters, type IsVipResponse } from "./_methods/isVip.ts";
import { l2Book, type L2BookParameters, type L2BookResponse } from "./_methods/l2Book.ts";
import { leadingVaults, type LeadingVaultsParameters, type LeadingVaultsResponse } from "./_methods/leadingVaults.ts";
import { legalCheck, type LegalCheckParameters, type LegalCheckResponse } from "./_methods/legalCheck.ts";
import { liquidatable, type LiquidatableResponse } from "./_methods/liquidatable.ts";
import { marginTable, type MarginTableParameters, type MarginTableResponse } from "./_methods/marginTable.ts";
import { maxBuilderFee, type MaxBuilderFeeParameters, type MaxBuilderFeeResponse } from "./_methods/maxBuilderFee.ts";
import { maxMarketOrderNtls, type MaxMarketOrderNtlsResponse } from "./_methods/maxMarketOrderNtls.ts";
import { meta, type MetaParameters, type MetaResponse } from "./_methods/meta.ts";
import {
  metaAndAssetCtxs,
  type MetaAndAssetCtxsParameters,
  type MetaAndAssetCtxsResponse,
} from "./_methods/metaAndAssetCtxs.ts";
import { openOrders, type OpenOrdersParameters, type OpenOrdersResponse } from "./_methods/openOrders.ts";
import { orderStatus, type OrderStatusParameters, type OrderStatusResponse } from "./_methods/orderStatus.ts";
import { outcomeMeta, type OutcomeMetaResponse } from "./_methods/outcomeMeta.ts";
import { outcomeTemplates, type OutcomeTemplatesResponse } from "./_methods/outcomeTemplates.ts";
import {
  perpAnnotation,
  type PerpAnnotationParameters,
  type PerpAnnotationResponse,
} from "./_methods/perpAnnotation.ts";
import { perpCategories, type PerpCategoriesResponse } from "./_methods/perpCategories.ts";
import { perpConciseAnnotations, type PerpConciseAnnotationsResponse } from "./_methods/perpConciseAnnotations.ts";
import { perpDeployAuctionStatus, type PerpDeployAuctionStatusResponse } from "./_methods/perpDeployAuctionStatus.ts";
import { perpDexLimits, type PerpDexLimitsParameters, type PerpDexLimitsResponse } from "./_methods/perpDexLimits.ts";
import { perpDexs, type PerpDexsResponse } from "./_methods/perpDexs.ts";
import { perpDexes, type PerpDexesResponse } from "./_methods/perpDexes.ts";
import { perpDexStatus, type PerpDexStatusParameters, type PerpDexStatusResponse } from "./_methods/perpDexStatus.ts";
import {
  perpsAtOpenInterestCap,
  type PerpsAtOpenInterestCapParameters,
  type PerpsAtOpenInterestCapResponse,
} from "./_methods/perpsAtOpenInterestCap.ts";
import { portfolio, type PortfolioParameters, type PortfolioResponse } from "./_methods/portfolio.ts";
import { predictedFundings, type PredictedFundingsResponse } from "./_methods/predictedFundings.ts";
import {
  preTransferCheck,
  type PreTransferCheckParameters,
  type PreTransferCheckResponse,
} from "./_methods/preTransferCheck.ts";
import { recentTrades, type RecentTradesParameters, type RecentTradesResponse } from "./_methods/recentTrades.ts";
import { referral, type ReferralParameters, type ReferralResponse } from "./_methods/referral.ts";
import {
  settledOutcome,
  type SettledOutcomeParameters,
  type SettledOutcomeResponse,
} from "./_methods/settledOutcome.ts";
import {
  spotClearinghouseState,
  type SpotClearinghouseStateParameters,
  type SpotClearinghouseStateResponse,
} from "./_methods/spotClearinghouseState.ts";
import {
  spotDeployState,
  type SpotDeployStateParameters,
  type SpotDeployStateResponse,
} from "./_methods/spotDeployState.ts";
import { spotMeta, type SpotMetaResponse } from "./_methods/spotMeta.ts";
import { spotMetaAndAssetCtxs, type SpotMetaAndAssetCtxsResponse } from "./_methods/spotMetaAndAssetCtxs.ts";
import {
  spotPairDeployAuctionStatus,
  type SpotPairDeployAuctionStatusResponse,
} from "./_methods/spotPairDeployAuctionStatus.ts";
import { subAccounts, type SubAccountsParameters, type SubAccountsResponse } from "./_methods/subAccounts.ts";
import { subAccounts2, type SubAccounts2Parameters, type SubAccounts2Response } from "./_methods/subAccounts2.ts";
import { subAccountsV2, type SubAccountsV2Parameters, type SubAccountsV2Response } from "./_methods/subAccountsV2.ts";
import { tokenDetails, type TokenDetailsParameters, type TokenDetailsResponse } from "./_methods/tokenDetails.ts";
import { twapHistory, type TwapHistoryParameters, type TwapHistoryResponse } from "./_methods/twapHistory.ts";
import { usdcRouting, type UsdcRoutingResponse } from "./_methods/usdcRouting.ts";
import {
  userAbstraction,
  type UserAbstractionParameters,
  type UserAbstractionResponse,
} from "./_methods/userAbstraction.ts";
import {
  userBorrowLendInterest,
  type UserBorrowLendInterestParameters,
  type UserBorrowLendInterestResponse,
} from "./_methods/userBorrowLendInterest.ts";
import {
  userDexAbstraction,
  type UserDexAbstractionParameters,
  type UserDexAbstractionResponse,
} from "./_methods/userDexAbstraction.ts";
import { userFees, type UserFeesParameters, type UserFeesResponse } from "./_methods/userFees.ts";
import { userFills, type UserFillsParameters, type UserFillsResponse } from "./_methods/userFills.ts";
import {
  userFillsByTime,
  type UserFillsByTimeParameters,
  type UserFillsByTimeResponse,
} from "./_methods/userFillsByTime.ts";
import { userFillsByTimeAll, type UserFillsByTimeAllParameters } from "./_methods/userFillsByTimeAll.ts";
import { userFillsByTimePages, type UserFillsByTimePagesParameters } from "./_methods/userFillsByTimePages.ts";
import { userFunding, type UserFundingParameters, type UserFundingResponse } from "./_methods/userFunding.ts";
import {
  userNonFundingLedgerUpdates,
  type UserNonFundingLedgerUpdatesParameters,
  type UserNonFundingLedgerUpdatesResponse,
} from "./_methods/userNonFundingLedgerUpdates.ts";
import {
  userNonFundingLedgerUpdatesAll,
  type UserNonFundingLedgerUpdatesAllParameters,
} from "./_methods/userNonFundingLedgerUpdatesAll.ts";
import {
  userNonFundingLedgerUpdatesPages,
  type UserNonFundingLedgerUpdatesPagesParameters,
} from "./_methods/userNonFundingLedgerUpdatesPages.ts";
import { userRateLimit, type UserRateLimitParameters, type UserRateLimitResponse } from "./_methods/userRateLimit.ts";
import { userRole, type UserRoleParameters, type UserRoleResponse } from "./_methods/userRole.ts";
import {
  userToMultiSigSigners,
  type UserToMultiSigSignersParameters,
  type UserToMultiSigSignersResponse,
} from "./_methods/userToMultiSigSigners.ts";
import {
  userTwapSliceFills,
  type UserTwapSliceFillsParameters,
  type UserTwapSliceFillsResponse,
} from "./_methods/userTwapSliceFills.ts";
import {
  userTwapSliceFillsByTime,
  type UserTwapSliceFillsByTimeParameters,
  type UserTwapSliceFillsByTimeResponse,
} from "./_methods/userTwapSliceFillsByTime.ts";
import {
  userTwapSliceFillsByTimeAll,
  type UserTwapSliceFillsByTimeAllParameters,
} from "./_methods/userTwapSliceFillsByTimeAll.ts";
import {
  userTwapSliceFillsByTimePages,
  type UserTwapSliceFillsByTimePagesParameters,
} from "./_methods/userTwapSliceFillsByTimePages.ts";
import {
  userVaultEquities,
  type UserVaultEquitiesParameters,
  type UserVaultEquitiesResponse,
} from "./_methods/userVaultEquities.ts";
import { validatorL1Votes, type ValidatorL1VotesResponse } from "./_methods/validatorL1Votes.ts";
import { validatorSummaries, type ValidatorSummariesResponse } from "./_methods/validatorSummaries.ts";
import { vaultDetails, type VaultDetailsParameters, type VaultDetailsResponse } from "./_methods/vaultDetails.ts";
import { vaultSummaries, type VaultSummariesResponse } from "./_methods/vaultSummaries.ts";
import { webData2, type WebData2Parameters, type WebData2Response } from "./_methods/webData2.ts";

// ============================================================
// Client
// ============================================================

/**
 * Read-only access to market data, user state, and other public information.
 *
 * Corresponds to the {@link https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint | Info endpoint}.
 */
export class InfoClient<C extends InfoConfig = InfoConfig> {
  readonly config: C;

  /**
   * Creates an instance of the InfoClient.
   *
   * @param config Configuration for Info API requests. See {@link InfoConfig}.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   *
   * const infoClient = new hl.InfoClient({ transport });
   * ```
   */
  constructor(config: C) {
    this.config = config;
  }

  /**
   * Request user active asset data.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User active asset data.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.activeAssetData({ user: "0x...", coin: "ETH" });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-users-active-asset-data
   */
  activeAssetData(params: ActiveAssetDataParameters, signal?: AbortSignal): Promise<ActiveAssetDataResponse> {
    return activeAssetData(this.config, params, signal);
  }

  /**
   * Request all borrow/lend reserve states.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of tuples of reserve IDs and their borrow/lend reserve state.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.allBorrowLendReserveStates();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-all-borrow-lend-reserve-states
   */
  allBorrowLendReserveStates(signal?: AbortSignal): Promise<AllBorrowLendReserveStatesResponse> {
    return allBorrowLendReserveStates(this.config, signal);
  }

  /**
   * Request mid coin prices.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Mapping of coin symbols to mid prices.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.allMids();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-mids-for-all-coins
   */
  allMids(params?: AllMidsParameters, signal?: AbortSignal): Promise<AllMidsResponse>;
  allMids(signal?: AbortSignal): Promise<AllMidsResponse>;
  allMids(paramsOrSignal?: AllMidsParameters | AbortSignal, maybeSignal?: AbortSignal): Promise<AllMidsResponse> {
    const params = isAbortSignal(paramsOrSignal) ? {} : paramsOrSignal;
    const signal = isAbortSignal(paramsOrSignal) ? paramsOrSignal : maybeSignal;
    return allMids(this.config, params, signal);
  }

  /**
   * Request trading metadata for all DEXs.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Metadata for perpetual assets across all DEXs.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.allPerpMetas();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-all-perpetuals-metadata-universe-and-margin-tables
   */
  allPerpMetas(signal?: AbortSignal): Promise<AllPerpMetasResponse> {
    return allPerpMetas(this.config, signal);
  }

  /**
   * Request approved builders for a user.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of approved builder addresses.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.approvedBuilders({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-approved-builders-for-user
   */
  approvedBuilders(params: ApprovedBuildersParameters, signal?: AbortSignal): Promise<ApprovedBuildersResponse> {
    return approvedBuilders(this.config, params, signal);
  }

  /**
   * Request borrow/lend reserve state.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Borrow/lend reserve state.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.borrowLendReserveState({ token: 0 });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-borrow-lend-reserve-state
   */
  borrowLendReserveState(
    params: BorrowLendReserveStateParameters,
    signal?: AbortSignal,
  ): Promise<BorrowLendReserveStateResponse> {
    return borrowLendReserveState(this.config, params, signal);
  }

  /**
   * Request borrow/lend user state.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User's borrow/lend state.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.borrowLendUserState({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-borrow-lend-user-state
   */
  borrowLendUserState(
    params: BorrowLendUserStateParameters,
    signal?: AbortSignal,
  ): Promise<BorrowLendUserStateResponse> {
    return borrowLendUserState(this.config, params, signal);
  }

  /**
   * Request candlestick snapshots.
   *
   * Only the most recent 5000 candles are available.
   * To paginate through a range that exceeds one response, use {@linkcode candleSnapshotAll}.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of candlestick data points.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.candleSnapshot({
   *   coin: "ETH",
   *   interval: "1h",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot
   */
  candleSnapshot(params: CandleSnapshotParameters, signal?: AbortSignal): Promise<CandleSnapshotResponse> {
    return candleSnapshot(this.config, params, signal);
  }

  /**
   * Request candlestick snapshots over a time range, automatically paginating until the range is exhausted.
   *
   * Repeatedly calls {@linkcode candleSnapshot}, re-requesting from the last returned candle's
   * opening time (`startTime` is inclusive) after each full page — the overlap is discarded,
   * matched by the candle's opening time `t` (exactly one candle exists per interval per opening
   * time) — and concatenates the pages. Stops at the first short page, when `options.maxPages`
   * pages have been fetched, or when a page contributes nothing new, so a misbehaving server
   * causes neither duplicates nor an infinite loop.
   *
   * Note: only the most recent 5000 candles are available from the server — that window is an
   * availability limit, not a pagination cap, so older history cannot be reached by paginating.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of candlestick data points.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.candleSnapshotAll({
   *   coin: "ETH",
   *   interval: "1h",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot
   */
  candleSnapshotAll(
    params: CandleSnapshotAllParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): Promise<CandleSnapshotResponse> {
    return candleSnapshotAll(this.config, params, options, signal);
  }

  /**
   * Request candlestick snapshots over a time range as a lazy stream of pages.
   *
   * Streaming form of {@linkcode candleSnapshotAll}: same walk — re-requesting from the last
   * returned candle's opening time (`startTime` is inclusive) after each full page, discarding the
   * overlap matched by the candle's opening time `t` (exactly one candle exists per interval per
   * opening time) — but each page is yielded as it arrives instead of buffering the whole range.
   * Nothing is requested until iteration starts, and breaking out of the loop stops the walk
   * without further requests. Ends at the first short page, when `options.maxPages` pages have been
   * fetched, or when a page contributes nothing new, so a misbehaving server causes neither
   * duplicates nor an infinite loop.
   *
   * Note: only the most recent 5000 candles are available from the server — that window is an
   * availability limit, not a pagination cap, so older history cannot be reached by paginating.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Async generator yielding pages of candlestick data points.
   *
   * @throws {ValidationError} When the pagination options fail validation (thrown by the first
   *   `next()` call, before any request is sent).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * for await (const page of client.candleSnapshotPages({
   *   coin: "ETH",
   *   interval: "1h",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * })) {
   *   console.log(`received ${page.length} candles`);
   * }
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot
   */
  candleSnapshotPages(
    params: CandleSnapshotPagesParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<CandleSnapshotResponse, void, undefined> {
    return candleSnapshotPages(this.config, params, options, signal);
  }

  /**
   * Request clearinghouse state.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Account summary for perpetual trading.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.clearinghouseState({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-users-perpetuals-account-summary
   */
  clearinghouseState(params: ClearinghouseStateParameters, signal?: AbortSignal): Promise<ClearinghouseStateResponse> {
    return clearinghouseState(this.config, params, signal);
  }

  /**
   * Request user staking delegations.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's delegations to validators.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.delegations({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-staking-delegations
   */
  delegations(params: DelegationsParameters, signal?: AbortSignal): Promise<DelegationsResponse> {
    return delegations(this.config, params, signal);
  }

  /**
   * Request user staking history.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of records of staking events by a delegator.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.delegatorHistory({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-staking-history
   */
  delegatorHistory(params: DelegatorHistoryParameters, signal?: AbortSignal): Promise<DelegatorHistoryResponse> {
    return delegatorHistory(this.config, params, signal);
  }

  /**
   * Request user staking rewards.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of rewards received from staking activities.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.delegatorRewards({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-staking-rewards
   */
  delegatorRewards(params: DelegatorRewardsParameters, signal?: AbortSignal): Promise<DelegatorRewardsResponse> {
    return delegatorRewards(this.config, params, signal);
  }

  /**
   * Request user's staking summary.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User's staking summary.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.delegatorSummary({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-staking-summary
   */
  delegatorSummary(params: DelegatorSummaryParameters, signal?: AbortSignal): Promise<DelegatorSummaryResponse> {
    return delegatorSummary(this.config, params, signal);
  }

  /**
   * Request exchange system status information.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Exchange system status information.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.exchangeStatus();
   * ```
   */
  exchangeStatus(signal?: AbortSignal): Promise<ExchangeStatusResponse> {
    return exchangeStatus(this.config, signal);
  }

  /**
   * Request user extra agents.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of extra agent details for a user.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.extraAgents({ user: "0x..." });
   * ```
   */
  extraAgents(params: ExtraAgentsParameters, signal?: AbortSignal): Promise<ExtraAgentsResponse> {
    return extraAgents(this.config, params, signal);
  }

  /**
   * Request frontend open orders.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of open orders with additional display information.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.frontendOpenOrders({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders-with-additional-frontend-info
   */
  frontendOpenOrders(params: FrontendOpenOrdersParameters, signal?: AbortSignal): Promise<FrontendOpenOrdersResponse> {
    return frontendOpenOrders(this.config, params, signal);
  }

  /**
   * Request funding history.
   *
   * Returns at most 500 records per response.
   * To fetch a larger range, use {@linkcode fundingHistoryAll}, which paginates automatically.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of historical funding rate records for an asset.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.fundingHistory({
   *   coin: "ETH",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-historical-funding-rates
   */
  fundingHistory(params: FundingHistoryParameters, signal?: AbortSignal): Promise<FundingHistoryResponse> {
    return fundingHistory(this.config, params, signal);
  }

  /**
   * Request all funding history, automatically paginating through the server's 500-records-per-response cap.
   *
   * Repeatedly calls {@linkcode fundingHistory}, re-requesting from the last returned timestamp
   * (`startTime` is inclusive) after each full page — the overlap is discarded, matched by the
   * record's `time` (there is exactly one funding record per coin per funding interval) — and
   * concatenates the pages. Stops at the first short page, when `options.maxPages` pages have been
   * fetched, or when a page contributes nothing new, so a misbehaving server causes neither
   * duplicates nor an infinite loop.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of historical funding rate records for an asset.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.fundingHistoryAll({
   *   coin: "ETH",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-historical-funding-rates
   */
  fundingHistoryAll(
    params: FundingHistoryAllParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): Promise<FundingHistoryResponse> {
    return fundingHistoryAll(this.config, params, options, signal);
  }

  /**
   * Request funding history as a lazy stream of pages, paginating through the server's 500-records-per-response cap.
   *
   * Streaming form of {@linkcode fundingHistoryAll}: same walk — re-requesting from the last
   * returned timestamp (`startTime` is inclusive) after each full page, discarding the overlap
   * matched by the record's `time` (there is exactly one funding record per coin per funding
   * interval) — but each page is yielded as it arrives instead of buffering the whole range.
   * Nothing is requested until iteration starts, and breaking out of the loop stops the walk
   * without further requests. Ends at the first short page, when `options.maxPages` pages have been
   * fetched, or when a page contributes nothing new, so a misbehaving server causes neither
   * duplicates nor an infinite loop.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Async generator yielding pages of historical funding rate records for an asset.
   *
   * @throws {ValidationError} When the pagination options fail validation (thrown by the first
   *   `next()` call, before any request is sent).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * for await (const page of client.fundingHistoryPages({
   *   coin: "ETH",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * })) {
   *   console.log(`received ${page.length} funding records`);
   * }
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-historical-funding-rates
   */
  fundingHistoryPages(
    params: FundingHistoryPagesParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<FundingHistoryResponse, void, undefined> {
    return fundingHistoryPages(this.config, params, options, signal);
  }

  /**
   * Request gossip priority auction status (previous winners and current auctions).
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Gossip priority auction status.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.gossipPriorityAuctionStatus();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/priority-fees
   */
  gossipPriorityAuctionStatus(signal?: AbortSignal): Promise<GossipPriorityAuctionStatusResponse> {
    return gossipPriorityAuctionStatus(this.config, signal);
  }

  /**
   * Request gossip root IPs.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of gossip root IPs.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.gossipRootIps();
   * ```
   */
  gossipRootIps(signal?: AbortSignal): Promise<GossipRootIpsResponse> {
    return gossipRootIps(this.config, signal);
  }

  /**
   * Request user historical orders.
   *
   * Returns at most 2000 most recent historical orders; the endpoint accepts no time range,
   * so it cannot be paginated.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of frontend orders with current processing status.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.historicalOrders({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-historical-orders
   */
  historicalOrders(params: HistoricalOrdersParameters, signal?: AbortSignal): Promise<HistoricalOrdersResponse> {
    return historicalOrders(this.config, params, signal);
  }

  /**
   * Request to check if a user is a VIP.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Boolean indicating user's VIP status.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.isVip({ user: "0x..." });
   * ```
   */
  isVip(params: IsVipParameters, signal?: AbortSignal): Promise<IsVipResponse> {
    return isVip(this.config, params, signal);
  }

  /**
   * Request L2 order book.
   *
   * Returns at most 20 levels per side.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return L2 order book snapshot.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.l2Book({ coin: "ETH", nSigFigs: 2 });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot
   */
  l2Book(params: L2BookParameters, signal?: AbortSignal): Promise<L2BookResponse> {
    return l2Book(this.config, params, signal);
  }

  /**
   * Request leading vaults for a user.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of leading vaults for a user.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.leadingVaults({ user: "0x..." });
   * ```
   */
  leadingVaults(params: LeadingVaultsParameters, signal?: AbortSignal): Promise<LeadingVaultsResponse> {
    return leadingVaults(this.config, params, signal);
  }

  /**
   * Request legal verification status of a user.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Legal verification status for a user.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.legalCheck({ user: "0x..." });
   * ```
   */
  legalCheck(params: LegalCheckParameters, signal?: AbortSignal): Promise<LegalCheckResponse> {
    return legalCheck(this.config, params, signal);
  }

  /**
   * Request liquidatable.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of liquidatable positions.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.liquidatable();
   * ```
   */
  liquidatable(signal?: AbortSignal): Promise<LiquidatableResponse> {
    return liquidatable(this.config, signal);
  }

  /**
   * Request margin table data.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Margin requirements table with multiple tiers.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.marginTable({ id: 1 });
   * ```
   */
  marginTable(params: MarginTableParameters, signal?: AbortSignal): Promise<MarginTableResponse> {
    return marginTable(this.config, params, signal);
  }

  /**
   * Request builder fee approval.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Maximum builder fee approval.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.maxBuilderFee({ user: "0x...", builder: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#check-builder-fee-approval
   */
  maxBuilderFee(params: MaxBuilderFeeParameters, signal?: AbortSignal): Promise<MaxBuilderFeeResponse> {
    return maxBuilderFee(this.config, params, signal);
  }

  /**
   * Request maximum market order notionals.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Maximum market order notionals.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.maxMarketOrderNtls();
   * ```
   */
  maxMarketOrderNtls(signal?: AbortSignal): Promise<MaxMarketOrderNtlsResponse> {
    return maxMarketOrderNtls(this.config, signal);
  }

  /**
   * Request trading metadata.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Metadata for perpetual assets.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.meta();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perpetuals-metadata-universe-and-margin-tables
   */
  meta(params?: MetaParameters, signal?: AbortSignal): Promise<MetaResponse>;
  meta(signal?: AbortSignal): Promise<MetaResponse>;
  meta(paramsOrSignal?: MetaParameters | AbortSignal, maybeSignal?: AbortSignal): Promise<MetaResponse> {
    const params = isAbortSignal(paramsOrSignal) ? {} : paramsOrSignal;
    const signal = isAbortSignal(paramsOrSignal) ? paramsOrSignal : maybeSignal;
    return meta(this.config, params, signal);
  }

  /**
   * Request metadata and asset contexts.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Metadata and context for perpetual assets.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.metaAndAssetCtxs();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perpetuals-asset-contexts-includes-mark-price-current-funding-open-interest-etc
   */
  metaAndAssetCtxs(params?: MetaAndAssetCtxsParameters, signal?: AbortSignal): Promise<MetaAndAssetCtxsResponse>;
  metaAndAssetCtxs(signal?: AbortSignal): Promise<MetaAndAssetCtxsResponse>;
  metaAndAssetCtxs(
    paramsOrSignal?: MetaAndAssetCtxsParameters | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<MetaAndAssetCtxsResponse> {
    const params = isAbortSignal(paramsOrSignal) ? {} : paramsOrSignal;
    const signal = isAbortSignal(paramsOrSignal) ? paramsOrSignal : maybeSignal;
    return metaAndAssetCtxs(this.config, params, signal);
  }

  /**
   * Request open orders.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of open orders.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.openOrders({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-open-orders
   */
  openOrders(params: OpenOrdersParameters, signal?: AbortSignal): Promise<OpenOrdersResponse> {
    return openOrders(this.config, params, signal);
  }

  /**
   * Request order status.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Order status response.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.orderStatus({ user: "0x...", oid: 12345 });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-order-status-by-oid-or-cloid
   */
  orderStatus(params: OrderStatusParameters, signal?: AbortSignal): Promise<OrderStatusResponse> {
    return orderStatus(this.config, params, signal);
  }

  /**
   * Request prediction market outcome metadata.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Prediction market outcome metadata including outcomes and questions.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.outcomeMeta();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-outcome-metadata
   */
  outcomeMeta(signal?: AbortSignal): Promise<OutcomeMetaResponse> {
    return outcomeMeta(this.config, signal);
  }

  /**
   * Request outcome templates.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of templates that outcome deployers instantiate.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.outcomeTemplates();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#read-api
   */
  outcomeTemplates(signal?: AbortSignal): Promise<OutcomeTemplatesResponse> {
    return outcomeTemplates(this.config, signal);
  }

  /**
   * Request perp annotation.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Perp annotation for an asset.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpAnnotation({ coin: "BTC" });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perp-annotation
   */
  perpAnnotation(params: PerpAnnotationParameters, signal?: AbortSignal): Promise<PerpAnnotationResponse> {
    return perpAnnotation(this.config, params, signal);
  }

  /**
   * Request all perpetual asset categories.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of tuples mapping coin names to their categories.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpCategories();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perp-categories
   */
  perpCategories(signal?: AbortSignal): Promise<PerpCategoriesResponse> {
    return perpCategories(this.config, signal);
  }

  /**
   * Request concise annotations for all perpetual assets.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of tuples mapping coin names to their concise annotations.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpConciseAnnotations();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-concise-perp-annotations
   */
  perpConciseAnnotations(signal?: AbortSignal): Promise<PerpConciseAnnotationsResponse> {
    return perpConciseAnnotations(this.config, signal);
  }

  /**
   * Request for the status of the perpetual deploy auction.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Status of the perpetual deploy auction.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpDeployAuctionStatus();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-information-about-the-perp-deploy-auction
   */
  perpDeployAuctionStatus(signal?: AbortSignal): Promise<PerpDeployAuctionStatusResponse> {
    return perpDeployAuctionStatus(this.config, signal);
  }

  /**
   * Request builder deployed perpetual market limits.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Builder deployed perpetual market limits.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpDexLimits({ dex: "test" });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-builder-deployed-perp-market-limits
   */
  perpDexLimits(params: PerpDexLimitsParameters, signal?: AbortSignal): Promise<PerpDexLimitsResponse> {
    return perpDexLimits(this.config, params, signal);
  }

  /**
   * Request all perpetual dexs.
   *
   * @deprecated use `perpDexes` — will be removed in v1.0.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of perpetual dexes (null is main dex).
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpDexs();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-all-perpetual-dexs
   */
  perpDexs(signal?: AbortSignal): Promise<PerpDexsResponse> {
    return perpDexs(this.config, signal);
  }

  /**
   * Request all perpetual dexes.
   *
   * Friendly alias of {@linkcode perpDexs} (the wire name): sends the same `perpDexs` request and
   * returns its response unchanged.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of perpetual dexes (null is main dex).
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpDexes();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-all-perpetual-dexs
   */
  perpDexes(signal?: AbortSignal): Promise<PerpDexesResponse> {
    return perpDexes(this.config, signal);
  }

  /**
   * Request perp DEX status.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Status of a perp DEX.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpDexStatus({ dex: "test" });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#get-perp-market-status
   */
  perpDexStatus(params: PerpDexStatusParameters, signal?: AbortSignal): Promise<PerpDexStatusResponse> {
    return perpDexStatus(this.config, params, signal);
  }

  /**
   * Request perpetuals at open interest cap.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of perpetuals at open interest caps.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.perpsAtOpenInterestCap();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#query-perps-at-open-interest-caps
   */
  perpsAtOpenInterestCap(
    params?: PerpsAtOpenInterestCapParameters,
    signal?: AbortSignal,
  ): Promise<PerpsAtOpenInterestCapResponse>;
  perpsAtOpenInterestCap(signal?: AbortSignal): Promise<PerpsAtOpenInterestCapResponse>;
  perpsAtOpenInterestCap(
    paramsOrSignal?: PerpsAtOpenInterestCapParameters | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<PerpsAtOpenInterestCapResponse> {
    const params = isAbortSignal(paramsOrSignal) ? {} : paramsOrSignal;
    const signal = isAbortSignal(paramsOrSignal) ? paramsOrSignal : maybeSignal;
    return perpsAtOpenInterestCap(this.config, params, signal);
  }

  /**
   * Request user portfolio.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Portfolio metrics grouped by time periods.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.portfolio({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-portfolio
   */
  portfolio(params: PortfolioParameters, signal?: AbortSignal): Promise<PortfolioResponse> {
    return portfolio(this.config, params, signal);
  }

  /**
   * Request predicted funding rates.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of predicted funding rates.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.predictedFundings();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-predicted-funding-rates-for-different-venues
   */
  predictedFundings(signal?: AbortSignal): Promise<PredictedFundingsResponse> {
    return predictedFundings(this.config, signal);
  }

  /**
   * Request user existence check before transfer.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Pre-transfer user existence check result.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.preTransferCheck({ user: "0x...", source: "0x..." });
   * ```
   */
  preTransferCheck(params: PreTransferCheckParameters, signal?: AbortSignal): Promise<PreTransferCheckResponse> {
    return preTransferCheck(this.config, params, signal);
  }

  /**
   * Request recent trades.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of recent trades.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.recentTrades({ coin: "ETH" });
   * ```
   */
  recentTrades(params: RecentTradesParameters, signal?: AbortSignal): Promise<RecentTradesResponse> {
    return recentTrades(this.config, params, signal);
  }

  /**
   * Request user referral.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Referral details for a user.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.referral({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-referral-information
   */
  referral(params: ReferralParameters, signal?: AbortSignal): Promise<ReferralResponse> {
    return referral(this.config, params, signal);
  }

  /**
   * Request information about a settled outcome.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Information about a settled outcome.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.settledOutcome({ outcome: 0 });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-information-about-a-settled-outcome
   */
  settledOutcome(params: SettledOutcomeParameters, signal?: AbortSignal): Promise<SettledOutcomeResponse> {
    return settledOutcome(this.config, params, signal);
  }

  /**
   * Request spot clearinghouse state.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Account summary for spot trading.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.spotClearinghouseState({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-a-users-token-balances
   */
  spotClearinghouseState(
    params: SpotClearinghouseStateParameters,
    signal?: AbortSignal,
  ): Promise<SpotClearinghouseStateResponse> {
    return spotClearinghouseState(this.config, params, signal);
  }

  /**
   * Request spot deploy state.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Deploy state for spot tokens.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.spotDeployState({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-information-about-the-spot-deploy-auction
   */
  spotDeployState(params: SpotDeployStateParameters, signal?: AbortSignal): Promise<SpotDeployStateResponse> {
    return spotDeployState(this.config, params, signal);
  }

  /**
   * Request spot trading metadata.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Metadata for spot assets.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.spotMeta();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-spot-metadata
   */
  spotMeta(signal?: AbortSignal): Promise<SpotMetaResponse> {
    return spotMeta(this.config, signal);
  }

  /**
   * Request spot metadata and asset contexts.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Metadata and context for spot assets.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.spotMetaAndAssetCtxs();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-spot-asset-contexts
   */
  spotMetaAndAssetCtxs(signal?: AbortSignal): Promise<SpotMetaAndAssetCtxsResponse> {
    return spotMetaAndAssetCtxs(this.config, signal);
  }

  /**
   * Request for the status of the spot deploy auction.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Status of the spot deploy auction.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.spotPairDeployAuctionStatus();
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-information-about-the-spot-pair-deploy-auction
   */
  spotPairDeployAuctionStatus(signal?: AbortSignal): Promise<SpotPairDeployAuctionStatusResponse> {
    return spotPairDeployAuctionStatus(this.config, signal);
  }

  /**
   * Request user sub-accounts.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user sub-account or null if the user does not have any sub-accounts.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.subAccounts({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-subaccounts
   */
  subAccounts(params: SubAccountsParameters, signal?: AbortSignal): Promise<SubAccountsResponse> {
    return subAccounts(this.config, params, signal);
  }

  /**
   * Request user sub-accounts V2.
   *
   * @deprecated use `subAccountsV2` — will be removed in v1.0.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user sub-account or null if the user does not have any sub-accounts.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.subAccounts2({ user: "0x..." });
   * ```
   */
  subAccounts2(params: SubAccounts2Parameters, signal?: AbortSignal): Promise<SubAccounts2Response> {
    return subAccounts2(this.config, params, signal);
  }

  /**
   * Request user sub-accounts V2.
   *
   * Friendly alias of {@linkcode subAccounts2} (the wire name): sends the same `subAccounts2`
   * request and returns its response unchanged.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user sub-account or null if the user does not have any sub-accounts.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.subAccountsV2({ user: "0x..." });
   * ```
   */
  subAccountsV2(params: SubAccountsV2Parameters, signal?: AbortSignal): Promise<SubAccountsV2Response> {
    return subAccountsV2(this.config, params, signal);
  }

  /**
   * Request token details.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Details of a token.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.tokenDetails({ tokenId: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-information-about-a-token
   */
  tokenDetails(params: TokenDetailsParameters, signal?: AbortSignal): Promise<TokenDetailsResponse> {
    return tokenDetails(this.config, params, signal);
  }

  /**
   * Request TWAP history of a user.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's TWAP history.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.twapHistory({ user: "0x..." });
   * ```
   */
  twapHistory(params: TwapHistoryParameters, signal?: AbortSignal): Promise<TwapHistoryResponse> {
    return twapHistory(this.config, params, signal);
  }

  /**
   * Request USDC transfer routing.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Routes currently used to move USDC in and out of the platform.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.usdcRouting();
   * ```
   */
  usdcRouting(signal?: AbortSignal): Promise<UsdcRoutingResponse> {
    return usdcRouting(this.config, signal);
  }

  /**
   * Request user abstraction state.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User abstraction state.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userAbstraction({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-abstraction-state
   */
  userAbstraction(params: UserAbstractionParameters, signal?: AbortSignal): Promise<UserAbstractionResponse> {
    return userAbstraction(this.config, params, signal);
  }

  /**
   * Request borrow/lend user interest.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User's borrow/lend interest.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userBorrowLendInterest({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24,
   * });
   * ```
   */
  userBorrowLendInterest(
    params: UserBorrowLendInterestParameters,
    signal?: AbortSignal,
  ): Promise<UserBorrowLendInterestResponse> {
    return userBorrowLendInterest(this.config, params, signal);
  }

  /**
   * Request user HIP-3 DEX abstraction state.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User HIP-3 DEX abstraction state.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userDexAbstraction({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-hip-3-dex-abstraction-state
   */
  userDexAbstraction(params: UserDexAbstractionParameters, signal?: AbortSignal): Promise<UserDexAbstractionResponse> {
    return userDexAbstraction(this.config, params, signal);
  }

  /**
   * Request user fees.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User fees.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userFees({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-fees
   */
  userFees(params: UserFeesParameters, signal?: AbortSignal): Promise<UserFeesResponse> {
    return userFees(this.config, params, signal);
  }

  /**
   * Request array of user fills.
   *
   * Returns at most 2000 most recent fills.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user trade fills.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userFills({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-fills
   */
  userFills(params: UserFillsParameters, signal?: AbortSignal): Promise<UserFillsResponse> {
    return userFills(this.config, params, signal);
  }

  /**
   * Request array of user fills by time.
   *
   * Returns at most 2000 fills per response; only the 10000 most recent fills are available.
   * To fetch a larger range, use {@linkcode userFillsByTimeAll}, which paginates automatically.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user trade fills by time.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userFillsByTime({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-fills-by-time
   */
  userFillsByTime(params: UserFillsByTimeParameters, signal?: AbortSignal): Promise<UserFillsByTimeResponse> {
    return userFillsByTime(this.config, params, signal);
  }

  /**
   * Request all user fills by time, automatically paginating through the server's 2000-fills-per-response cap.
   *
   * Repeatedly calls {@linkcode userFillsByTime}, re-requesting from the last returned timestamp
   * (`startTime` is inclusive) after each full page — the overlap is discarded, matched by fill
   * `tid`, which is unique per fill — and concatenates the pages. Stops at the first short page,
   * when `options.maxPages` pages have been fetched, or when a page contributes nothing new, so a
   * misbehaving server causes neither duplicates nor an infinite loop.
   *
   * Note: only the 10000 most recent fills are available from the server, regardless of pagination.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user trade fills by time.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userFillsByTimeAll({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-fills-by-time
   */
  userFillsByTimeAll(
    params: UserFillsByTimeAllParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): Promise<UserFillsByTimeResponse> {
    return userFillsByTimeAll(this.config, params, options, signal);
  }

  /**
   * Request user fills by time as a lazy stream of pages, paginating through the server's 2000-fills-per-response cap.
   *
   * Streaming form of {@linkcode userFillsByTimeAll}: same walk — re-requesting from the last
   * returned timestamp (`startTime` is inclusive) after each full page, discarding the overlap
   * matched by fill `tid`, which is unique per fill — but each page is yielded as it arrives
   * instead of buffering the whole range. Nothing is requested until iteration starts, and breaking
   * out of the loop stops the walk without further requests. Ends at the first short page, when
   * `options.maxPages` pages have been fetched, or when a page contributes nothing new, so a
   * misbehaving server causes neither duplicates nor an infinite loop.
   *
   * Note: only the 10000 most recent fills are available from the server, regardless of pagination.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Async generator yielding pages of user trade fills by time.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending), or when
   *   the pagination options fail validation (thrown by the first `next()` call, before any request
   *   is sent).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * for await (const page of client.userFillsByTimePages({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * })) {
   *   console.log(`received ${page.length} fills`);
   * }
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-fills-by-time
   */
  userFillsByTimePages(
    params: UserFillsByTimePagesParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<UserFillsByTimeResponse, void, undefined> {
    return userFillsByTimePages(this.config, params, options, signal);
  }

  /**
   * Request array of user funding ledger updates.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user funding ledger updates.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userFunding({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
   */
  userFunding(params: UserFundingParameters, signal?: AbortSignal): Promise<UserFundingResponse> {
    return userFunding(this.config, params, signal);
  }

  /**
   * Request user non-funding ledger updates.
   *
   * The response is capped per request for a given time range.
   * To fetch a larger range, use {@linkcode userNonFundingLedgerUpdatesAll}, which paginates automatically.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's non-funding ledger update.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userNonFundingLedgerUpdates({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
   */
  userNonFundingLedgerUpdates(
    params: UserNonFundingLedgerUpdatesParameters,
    signal?: AbortSignal,
  ): Promise<UserNonFundingLedgerUpdatesResponse> {
    return userNonFundingLedgerUpdates(this.config, params, signal);
  }

  /**
   * Request all user non-funding ledger updates, automatically paginating through the server's per-response cap.
   *
   * Repeatedly calls {@linkcode userNonFundingLedgerUpdates}, re-requesting from the last returned
   * timestamp (`startTime` is inclusive) after each full page — the overlap is discarded, matched
   * by the update's L1 transaction `hash` and `time` (one L1 transaction produces at most one
   * non-funding ledger update per user) — and concatenates the pages. Stops at the first short
   * page, when `options.maxPages` pages have been fetched, or when a page contributes nothing new,
   * so a misbehaving server causes neither duplicates nor an infinite loop.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's non-funding ledger update.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userNonFundingLedgerUpdatesAll({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
   */
  userNonFundingLedgerUpdatesAll(
    params: UserNonFundingLedgerUpdatesAllParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): Promise<UserNonFundingLedgerUpdatesResponse> {
    return userNonFundingLedgerUpdatesAll(this.config, params, options, signal);
  }

  /**
   * Request user non-funding ledger updates as a lazy stream of pages, paginating through the server's per-response cap.
   *
   * Streaming form of {@linkcode userNonFundingLedgerUpdatesAll}: same walk — re-requesting from
   * the last returned timestamp (`startTime` is inclusive) after each full page, discarding the
   * overlap matched by the update's L1 transaction `hash` and `time` (one L1 transaction produces
   * at most one non-funding ledger update per user) — but each page is yielded as it arrives
   * instead of buffering the whole range. Nothing is requested until iteration starts, and breaking
   * out of the loop stops the walk without further requests. Ends at the first short page, when
   * `options.maxPages` pages have been fetched, or when a page contributes nothing new, so a
   * misbehaving server causes neither duplicates nor an infinite loop.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Async generator yielding pages of user's non-funding ledger update.
   *
   * @throws {ValidationError} When the pagination options fail validation (thrown by the first
   *   `next()` call, before any request is sent).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * for await (const page of client.userNonFundingLedgerUpdatesPages({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * })) {
   *   console.log(`received ${page.length} ledger updates`);
   * }
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history-or-non-funding-ledger-updates
   */
  userNonFundingLedgerUpdatesPages(
    params: UserNonFundingLedgerUpdatesPagesParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<UserNonFundingLedgerUpdatesResponse, void, undefined> {
    return userNonFundingLedgerUpdatesPages(this.config, params, options, signal);
  }

  /**
   * Request user rate limits.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User rate limits.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userRateLimit({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-user-rate-limits
   */
  userRateLimit(params: UserRateLimitParameters, signal?: AbortSignal): Promise<UserRateLimitResponse> {
    return userRateLimit(this.config, params, signal);
  }

  /**
   * Request user role.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return User role.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userRole({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-a-users-role
   */
  userRole(params: UserRoleParameters, signal?: AbortSignal): Promise<UserRoleResponse> {
    return userRole(this.config, params, signal);
  }

  /**
   * Request multi-sig signers for a user.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Multi-sig signers for a user or null if the user does not have any multi-sig signers.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userToMultiSigSigners({ user: "0x..." });
   * ```
   */
  userToMultiSigSigners(
    params: UserToMultiSigSignersParameters,
    signal?: AbortSignal,
  ): Promise<UserToMultiSigSignersResponse> {
    return userToMultiSigSigners(this.config, params, signal);
  }

  /**
   * Request user TWAP slice fills.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's TWAP slice fills.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userTwapSliceFills({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
   */
  userTwapSliceFills(params: UserTwapSliceFillsParameters, signal?: AbortSignal): Promise<UserTwapSliceFillsResponse> {
    return userTwapSliceFills(this.config, params, signal);
  }

  /**
   * Request user TWAP slice fills by time.
   *
   * The response is capped per request for a given time range.
   * To fetch a larger range, use {@linkcode userTwapSliceFillsByTimeAll}, which paginates automatically.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's TWAP slice fill by time.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userTwapSliceFillsByTime({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
   */
  userTwapSliceFillsByTime(
    params: UserTwapSliceFillsByTimeParameters,
    signal?: AbortSignal,
  ): Promise<UserTwapSliceFillsByTimeResponse> {
    return userTwapSliceFillsByTime(this.config, params, signal);
  }

  /**
   * Request all user TWAP slice fills by time, automatically paginating through the server's per-response cap.
   *
   * Repeatedly calls {@linkcode userTwapSliceFillsByTime}, re-requesting from the last returned
   * timestamp (`startTime` is inclusive) after each full page — the overlap is discarded, matched
   * by the nested fill's `tid`, which is unique per fill — and concatenates the pages. Stops at the
   * first short page, when `options.maxPages` pages have been fetched, or when a page contributes
   * nothing new, so a misbehaving server causes neither duplicates nor an infinite loop.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's TWAP slice fill by time.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userTwapSliceFillsByTimeAll({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
   */
  userTwapSliceFillsByTimeAll(
    params: UserTwapSliceFillsByTimeAllParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): Promise<UserTwapSliceFillsByTimeResponse> {
    return userTwapSliceFillsByTimeAll(this.config, params, options, signal);
  }

  /**
   * Request user TWAP slice fills by time as a lazy stream of pages, paginating through the server's per-response cap.
   *
   * Streaming form of {@linkcode userTwapSliceFillsByTimeAll}: same walk — re-requesting from the
   * last returned timestamp (`startTime` is inclusive) after each full page, discarding the overlap
   * matched by the nested fill's `tid`, which is unique per fill — but each page is yielded as it
   * arrives instead of buffering the whole range. Nothing is requested until iteration starts, and
   * breaking out of the loop stops the walk without further requests. Ends at the first short page,
   * when `options.maxPages` pages have been fetched, or when a page contributes nothing new, so a
   * misbehaving server causes neither duplicates nor an infinite loop.
   *
   * @param params Parameters specific to the API request.
   * @param options Pagination options (see {@linkcode PaginationOptions}).
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Async generator yielding pages of user's TWAP slice fill by time.
   *
   * @throws {ValidationError} When the pagination options fail validation (thrown by the first
   *   `next()` call, before any request is sent).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * for await (const page of client.userTwapSliceFillsByTimePages({
   *   user: "0x...",
   *   startTime: Date.now() - 1000 * 60 * 60 * 24 * 7,
   * })) {
   *   console.log(`received ${page.length} TWAP slice fills`);
   * }
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-twap-slice-fills
   */
  userTwapSliceFillsByTimePages(
    params: UserTwapSliceFillsByTimePagesParameters,
    options?: PaginationOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<UserTwapSliceFillsByTimeResponse, void, undefined> {
    return userTwapSliceFillsByTimePages(this.config, params, options, signal);
  }

  /**
   * Request user vault deposits.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of user's vault deposits.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.userVaultEquities({ user: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-vault-deposits
   */
  userVaultEquities(params: UserVaultEquitiesParameters, signal?: AbortSignal): Promise<UserVaultEquitiesResponse> {
    return userVaultEquities(this.config, params, signal);
  }

  /**
   * Request validator L1 votes.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of L1 governance votes cast by validators.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.validatorL1Votes();
   * ```
   */
  validatorL1Votes(signal?: AbortSignal): Promise<ValidatorL1VotesResponse> {
    return validatorL1Votes(this.config, signal);
  }

  /**
   * Request validator summaries.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of validator performance statistics.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.validatorSummaries();
   * ```
   */
  validatorSummaries(signal?: AbortSignal): Promise<ValidatorSummariesResponse> {
    return validatorSummaries(this.config, signal);
  }

  /**
   * Request details of a vault.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Details of a vault or null if the vault does not exist.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.vaultDetails({ vaultAddress: "0x..." });
   * ```
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-details-for-a-vault
   */
  vaultDetails(params: VaultDetailsParameters, signal?: AbortSignal): Promise<VaultDetailsResponse> {
    return vaultDetails(this.config, params, signal);
  }

  /**
   * Request a list of vaults less than 2 hours old.
   *
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Array of vaults less than 2 hours old.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.vaultSummaries();
   * ```
   */
  vaultSummaries(signal?: AbortSignal): Promise<VaultSummariesResponse> {
    return vaultSummaries(this.config, signal);
  }

  /**
   * Request comprehensive user and market data.
   *
   * @deprecated use `webData3` and other component subscriptions instead — will be removed in v1.0.
   *
   * @param params Parameters specific to the API request.
   * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
   * @return Comprehensive user and market data.
   *
   * @throws {ValidationError} When the request parameters fail validation (before sending).
   * @throws {TransportError} When the transport layer throws an error.
   *
   * @example
   * ```ts
   * import * as hl from "@bloxwap/hyperliquid";
   *
   * const transport = new hl.HttpTransport(); // or `WebSocketTransport`
   * const client = new hl.InfoClient({ transport });
   *
   * const data = await client.webData2({ user: "0x..." });
   * ```
   */
  webData2(params: WebData2Parameters, signal?: AbortSignal): Promise<WebData2Response> {
    return webData2(this.config, params, signal);
  }
}

// ============================================================
// Type Re-exports
// ============================================================

export type { InfoConfig } from "./_methods/_base/mod.ts";

export type { ActiveAssetDataParameters, ActiveAssetDataResponse } from "./_methods/activeAssetData.ts";
export type { AllBorrowLendReserveStatesResponse } from "./_methods/allBorrowLendReserveStates.ts";
export type { AllMidsParameters, AllMidsResponse } from "./_methods/allMids.ts";
export type { AllPerpMetasResponse } from "./_methods/allPerpMetas.ts";
export type { ApprovedBuildersParameters, ApprovedBuildersResponse } from "./_methods/approvedBuilders.ts";
export type {
  BorrowLendReserveStateParameters,
  BorrowLendReserveStateResponse,
} from "./_methods/borrowLendReserveState.ts";
export type { BorrowLendUserStateParameters, BorrowLendUserStateResponse } from "./_methods/borrowLendUserState.ts";
export type { CandleSnapshotParameters, CandleSnapshotResponse } from "./_methods/candleSnapshot.ts";
export type { CandleSnapshotAllParameters } from "./_methods/candleSnapshotAll.ts";
export type { CandleSnapshotPagesParameters } from "./_methods/candleSnapshotPages.ts";
export type { ClearinghouseStateParameters, ClearinghouseStateResponse } from "./_methods/clearinghouseState.ts";
export type { DelegationsParameters, DelegationsResponse } from "./_methods/delegations.ts";
export type { DelegatorHistoryParameters, DelegatorHistoryResponse } from "./_methods/delegatorHistory.ts";
export type { DelegatorRewardsParameters, DelegatorRewardsResponse } from "./_methods/delegatorRewards.ts";
export type { DelegatorSummaryParameters, DelegatorSummaryResponse } from "./_methods/delegatorSummary.ts";
export type { ExchangeStatusResponse } from "./_methods/exchangeStatus.ts";
export type { ExtraAgentsParameters, ExtraAgentsResponse } from "./_methods/extraAgents.ts";
export type { FrontendOpenOrdersParameters, FrontendOpenOrdersResponse } from "./_methods/frontendOpenOrders.ts";
export type { FundingHistoryParameters, FundingHistoryResponse } from "./_methods/fundingHistory.ts";
export type { FundingHistoryAllParameters } from "./_methods/fundingHistoryAll.ts";
export type { FundingHistoryPagesParameters } from "./_methods/fundingHistoryPages.ts";
export type { GossipPriorityAuctionStatusResponse } from "./_methods/gossipPriorityAuctionStatus.ts";
export type { GossipRootIpsResponse } from "./_methods/gossipRootIps.ts";
export type { HistoricalOrdersParameters, HistoricalOrdersResponse } from "./_methods/historicalOrders.ts";
export type { IsVipParameters, IsVipResponse } from "./_methods/isVip.ts";
export type { L2BookParameters, L2BookResponse } from "./_methods/l2Book.ts";
export type { LeadingVaultsParameters, LeadingVaultsResponse } from "./_methods/leadingVaults.ts";
export type { LegalCheckParameters, LegalCheckResponse } from "./_methods/legalCheck.ts";
export type { LiquidatableResponse } from "./_methods/liquidatable.ts";
export type { MarginTableParameters, MarginTableResponse } from "./_methods/marginTable.ts";
export type { MaxBuilderFeeParameters, MaxBuilderFeeResponse } from "./_methods/maxBuilderFee.ts";
export type { MaxMarketOrderNtlsResponse } from "./_methods/maxMarketOrderNtls.ts";
export type { MetaParameters, MetaResponse } from "./_methods/meta.ts";
export type { MetaAndAssetCtxsParameters, MetaAndAssetCtxsResponse } from "./_methods/metaAndAssetCtxs.ts";
export type { OpenOrdersParameters, OpenOrdersResponse } from "./_methods/openOrders.ts";
export type { OrderStatusParameters, OrderStatusResponse } from "./_methods/orderStatus.ts";
export type { OutcomeMetaResponse } from "./_methods/outcomeMeta.ts";
export type { OutcomeTemplatesResponse } from "./_methods/outcomeTemplates.ts";
export type { PerpAnnotationParameters, PerpAnnotationResponse } from "./_methods/perpAnnotation.ts";
export type { PerpCategoriesResponse } from "./_methods/perpCategories.ts";
export type { PerpConciseAnnotationsResponse } from "./_methods/perpConciseAnnotations.ts";
export type { PerpDeployAuctionStatusResponse } from "./_methods/perpDeployAuctionStatus.ts";
export type { PerpDexLimitsParameters, PerpDexLimitsResponse } from "./_methods/perpDexLimits.ts";
export type { PerpDexsResponse } from "./_methods/perpDexs.ts";
export type { PerpDexesResponse } from "./_methods/perpDexes.ts";
export type { PerpDexStatusParameters, PerpDexStatusResponse } from "./_methods/perpDexStatus.ts";
export type {
  PerpsAtOpenInterestCapParameters,
  PerpsAtOpenInterestCapResponse,
} from "./_methods/perpsAtOpenInterestCap.ts";
export type { PortfolioParameters, PortfolioResponse } from "./_methods/portfolio.ts";
export type { PredictedFundingsResponse } from "./_methods/predictedFundings.ts";
export type { PreTransferCheckParameters, PreTransferCheckResponse } from "./_methods/preTransferCheck.ts";
export type { RecentTradesParameters, RecentTradesResponse } from "./_methods/recentTrades.ts";
export type { ReferralParameters, ReferralResponse } from "./_methods/referral.ts";
export type { SettledOutcomeParameters, SettledOutcomeResponse } from "./_methods/settledOutcome.ts";
export type {
  SpotClearinghouseStateParameters,
  SpotClearinghouseStateResponse,
} from "./_methods/spotClearinghouseState.ts";
export type { SpotDeployStateParameters, SpotDeployStateResponse } from "./_methods/spotDeployState.ts";
export type { SpotMetaResponse } from "./_methods/spotMeta.ts";
export type { SpotMetaAndAssetCtxsResponse } from "./_methods/spotMetaAndAssetCtxs.ts";
export type { SpotPairDeployAuctionStatusResponse } from "./_methods/spotPairDeployAuctionStatus.ts";
export type { SubAccountsParameters, SubAccountsResponse } from "./_methods/subAccounts.ts";
export type { SubAccounts2Parameters, SubAccounts2Response } from "./_methods/subAccounts2.ts";
export type { SubAccountsV2Parameters, SubAccountsV2Response } from "./_methods/subAccountsV2.ts";
export type { TokenDetailsParameters, TokenDetailsResponse } from "./_methods/tokenDetails.ts";
export type { TwapHistoryParameters, TwapHistoryResponse } from "./_methods/twapHistory.ts";
export type { UsdcRoutingResponse } from "./_methods/usdcRouting.ts";
export type { UserAbstractionParameters, UserAbstractionResponse } from "./_methods/userAbstraction.ts";
export type {
  UserBorrowLendInterestParameters,
  UserBorrowLendInterestResponse,
} from "./_methods/userBorrowLendInterest.ts";
export type {
  UserDexAbstractionParameters as UserDexAbstractionInfoParameters,
  UserDexAbstractionResponse as UserDexAbstractionInfoResponse,
} from "./_methods/userDexAbstraction.ts";
export type { UserFeesParameters, UserFeesResponse } from "./_methods/userFees.ts";
export type { UserFillsParameters, UserFillsResponse } from "./_methods/userFills.ts";
export type { UserFillsByTimeParameters, UserFillsByTimeResponse } from "./_methods/userFillsByTime.ts";
export type { UserFillsByTimeAllParameters } from "./_methods/userFillsByTimeAll.ts";
export type { UserFillsByTimePagesParameters } from "./_methods/userFillsByTimePages.ts";
export type { UserFundingParameters, UserFundingResponse } from "./_methods/userFunding.ts";
export type {
  UserNonFundingLedgerUpdatesParameters,
  UserNonFundingLedgerUpdatesResponse,
} from "./_methods/userNonFundingLedgerUpdates.ts";
export type { UserNonFundingLedgerUpdatesAllParameters } from "./_methods/userNonFundingLedgerUpdatesAll.ts";
export type { UserNonFundingLedgerUpdatesPagesParameters } from "./_methods/userNonFundingLedgerUpdatesPages.ts";
export type { UserRateLimitParameters, UserRateLimitResponse } from "./_methods/userRateLimit.ts";
export type { UserRoleParameters, UserRoleResponse } from "./_methods/userRole.ts";
export type {
  UserToMultiSigSignersParameters,
  UserToMultiSigSignersResponse,
} from "./_methods/userToMultiSigSigners.ts";
export type { UserTwapSliceFillsParameters, UserTwapSliceFillsResponse } from "./_methods/userTwapSliceFills.ts";
export type {
  UserTwapSliceFillsByTimeParameters,
  UserTwapSliceFillsByTimeResponse,
} from "./_methods/userTwapSliceFillsByTime.ts";
export type { UserTwapSliceFillsByTimeAllParameters } from "./_methods/userTwapSliceFillsByTimeAll.ts";
export type { UserTwapSliceFillsByTimePagesParameters } from "./_methods/userTwapSliceFillsByTimePages.ts";
export type { UserVaultEquitiesParameters, UserVaultEquitiesResponse } from "./_methods/userVaultEquities.ts";
export type { ValidatorL1VotesResponse } from "./_methods/validatorL1Votes.ts";
export type { ValidatorSummariesResponse } from "./_methods/validatorSummaries.ts";
export type { VaultDetailsParameters, VaultDetailsResponse } from "./_methods/vaultDetails.ts";
export type { VaultSummariesResponse } from "./_methods/vaultSummaries.ts";
export type { WebData2Parameters, WebData2Response } from "./_methods/webData2.ts";
