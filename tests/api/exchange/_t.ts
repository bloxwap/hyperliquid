/**
 * Shared helpers for live Exchange API tests.
 * @module
 */

import { describe, test } from "bun:test";
import {
  ExchangeClient,
  type ExchangeMultiSigConfig,
  type ExchangeSingleWalletConfig,
  HttpTransport,
  InfoClient,
} from "@bloxwap/hyperliquid";
import { getWalletAddress } from "@bloxwap/hyperliquid/signing";
import { formatPrice, formatSize, SymbolConverter } from "@bloxwap/hyperliquid/utils";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { OFFLINE } from "../../_offline.ts";
import { createTestContext, type TestContext } from "../../_testContext.ts";

// ============================================================
// Arguments
// ============================================================

const WAIT = 5000;

/** Generous per-test budget: every case pays the rate-limit delay plus several testnet round trips. */
const TIMEOUT = 120_000;

// Bun loads `.env` on startup, so no dotenv shim is needed here.
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const MAIN_WALLET = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY) : undefined;

/**
 * Whether {@linkcode createTempExchangeClient} can run, i.e. whether a funded `PRIVATE_KEY` is
 * configured to pay for the throwaway account.
 *
 * Exported as a predicate rather than exporting `MAIN_WALLET` itself: every caller outside this
 * module wants the guard, not the key. Harnesses in other API families that create a temporary
 * account MUST skip on it — see the note on {@linkcode createTempExchangeClient}.
 */
export const CAN_FUND_TEMP_ACCOUNT: boolean = MAIN_WALLET !== undefined;

// ============================================================
// Preparation
// ============================================================

const transport = new HttpTransport({ isTestnet: true, timeout: 30_000 });
const infoClient = new InfoClient({ transport });

// These are only consumed by network tests, which are skipped in offline mode, so the unused values are safe.
export const symbolConverter = OFFLINE
  ? (undefined as unknown as SymbolConverter)
  : await SymbolConverter.create({ transport });
export const allMids = OFFLINE
  ? (undefined as unknown as Awaited<ReturnType<typeof infoClient.allMids>>)
  : await infoClient.allMids();

// ============================================================
// Test
// ============================================================

/**
 * Runs an exchange action test once per client flavour (single-wallet and multi-sig).
 *
 * Each flavour is its own `bun:test` case inside a `describe` named after the action, so a failure
 * names the flavour that broke. Skipped when offline or when no `PRIVATE_KEY` is configured.
 *
 * @param options Test options.
 * @param options.name Name of the exchange action under test.
 * @param options.skipMultiSig Runs only the single-wallet flavour when `true`.
 * @param options.codeTestFn Test body; receives a test context and a temporary funded client.
 */
export function runTest(options: {
  name: string;
  skipMultiSig?: boolean;
  codeTestFn: (
    t: TestContext,
    exchClient: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>,
  ) => Promise<void>;
}): void {
  const { name, skipMultiSig, codeTestFn } = options;

  const clientTypes = skipMultiSig ? (["user"] as const) : (["user", "multisig"] as const);

  describe.skipIf(OFFLINE || !MAIN_WALLET)(name, () => {
    for (const clientType of clientTypes) {
      test(
        clientType,
        async () => {
          await new Promise((r) => setTimeout(r, WAIT)); // delay to avoid rate limits

          const exchClient = await createTempExchangeClient(clientType);
          try {
            await codeTestFn(createTestContext([name, clientType]), exchClient);
          } finally {
            // Always reclaim the temporary account's funds, even when the assertions fail.
            await cleanupTempExchangeClient(exchClient);
          }
        },
        TIMEOUT,
      );
    }
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Funds a throwaway testnet account and returns a client for it, optionally as a multi-sig user.
 *
 * Requires a funded `PRIVATE_KEY`. Callers must skip on {@linkcode CAN_FUND_TEMP_ACCOUNT} rather
 * than calling this without one — an unguarded call used to reach `ExchangeClient` with
 * `MAIN_WALLET!` as `undefined`, where the non-null assertion silenced the type error and the
 * test failed several frames later with `TypeError: wallet is not an Object`, which names
 * neither the missing key nor the harness that forgot to check.
 */
export async function createTempExchangeClient(
  type: "user" | "multisig",
): Promise<ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>> {
  if (MAIN_WALLET === undefined) {
    throw new Error(
      "createTempExchangeClient() needs a funded PRIVATE_KEY to activate the throwaway account. " +
        "Set PRIVATE_KEY, or skip the test on CAN_FUND_TEMP_ACCOUNT.",
    );
  }
  const mainExchClient = new ExchangeClient({ wallet: MAIN_WALLET, transport });

  // Create temporary account
  const tempWallet = privateKeyToAccount(generatePrivateKey());
  const tempExchClient = new ExchangeClient({ wallet: tempWallet, transport });

  // Activate account
  await mainExchClient.usdSend({ destination: tempWallet.address, amount: "2" });

  if (type === "user") {
    // Return as single-wallet ExchangeClient
    return tempExchClient;
  } else {
    // Convert to MultiSigUser
    await tempExchClient.convertToMultiSigUser({
      signers: {
        authorizedUsers: [MAIN_WALLET!.address],
        threshold: 1,
      },
    });

    // Return as multi-sig ExchangeClient
    return new ExchangeClient({
      multiSigUser: tempWallet.address,
      signers: [MAIN_WALLET!],
      transport,
    });
  }
}

/** Cancels every open order/TWAP, flattens positions, and sweeps the remaining funds back to the main wallet. */
export async function cleanupTempExchangeClient(
  tempClient: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>,
): Promise<void> {
  const tempUser =
    "multiSigUser" in tempClient.config_
      ? tempClient.config_.multiSigUser
      : await getWalletAddress(tempClient.config_.wallet);

  const webData2 = await infoClient.webData2({ user: tempUser });

  // Cancel all open orders
  const cancels = webData2.openOrders.map((o) => ({ a: symbolConverter.getAssetId(o.coin)!, o: o.oid }));
  if (cancels.length > 0) {
    await tempClient.cancel({ cancels }).catch(() => undefined);
  }

  // Cancel all running TWAPs
  for (const [twapId, state] of webData2.twapStates) {
    const id = symbolConverter.getAssetId(state.coin)!;
    await tempClient.twapCancel({ a: id, t: twapId }).catch(() => undefined);
  }

  // Close all positions
  await Promise.all(
    webData2.clearinghouseState.assetPositions.map(async (pos) => {
      const id = symbolConverter.getAssetId(pos.position.coin)!;
      const szDecimals = symbolConverter.getSzDecimals(pos.position.coin)!;
      const px = Number(pos.position.entryPx) * (pos.position.positionValue.startsWith("-") ? 1.05 : 0.95);
      await tempClient
        .order({
          orders: [
            {
              a: id,
              b: false,
              p: formatPrice(px, szDecimals),
              s: "0", // full position size
              r: true,
              t: { limit: { tif: "Gtc" } },
            },
          ],
          grouping: "na",
        })
        .catch(() => undefined);
    }),
  );

  // Withdraw all funds back to main account
  await infoClient.clearinghouseState({ user: tempUser }).then(async (state) => {
    await tempClient.usdSend({ destination: MAIN_WALLET!.address, amount: state.withdrawable }).catch(() => undefined);
  });
  await infoClient.spotClearinghouseState({ user: tempUser }).then(async (state) => {
    const usdcBalance = Number(state.balances.find((b) => b.coin === "USDC")?.total ?? "0");
    if (usdcBalance > 0) {
      await tempClient
        .spotSend({
          destination: MAIN_WALLET!.address,
          token: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
          amount: usdcBalance,
        })
        .catch(() => undefined);
    }
  });
}

/** Tops the account up and places one order, returning everything a test needs to reference it later. */
export async function openOrder(
  client: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>,
  type: "market" | "limit",
  symbol = "SOL",
  side: "buy" | "sell" = "buy",
  slippage = 0.05, // 5%
): Promise<{
  a: number;
  b: boolean;
  p: string;
  s: string;
  oid: number;
  cloid: `0x${string}`;
  pxUp: string;
  pxDown: string;
  midPx: string;
}> {
  // Top-up account
  await topUpPerp(client, "20");

  // Get market data
  const id = symbolConverter.getAssetId(symbol)!;
  const szDecimals = symbolConverter.getSzDecimals(symbol)!;
  const midPx = allMids[symbol];

  // Calculate order parameters
  const pxDown = formatPrice(Number(midPx) * (1 - slippage), szDecimals);
  const pxUp = formatPrice(Number(midPx) * (1 + slippage), szDecimals);
  const sz = formatSize(15 / Number(midPx), szDecimals);

  let executionPx: string;
  if (type === "market") {
    executionPx = side === "buy" ? pxUp : pxDown;
  } else {
    executionPx = side === "buy" ? pxDown : pxUp;
  }

  // Place order
  const result = await client.order({
    orders: [
      {
        a: id,
        b: side === "buy",
        p: executionPx,
        s: sz,
        r: false,
        t: { limit: { tif: "Gtc" } },
        c: "0x17a5a40306205a0c6d60c7264153781c",
      },
    ],
    grouping: "na",
  });

  // Extract order info
  const [order] = result.response.data.statuses as
    | { resting: { oid: number; cloid: `0x${string}` } }[]
    | { filled: { oid: number; cloid: `0x${string}` } }[];
  return {
    a: id,
    b: side === "buy",
    p: executionPx,
    s: sz,
    oid: "resting" in order ? order.resting.oid : order.filled.oid,
    cloid: "resting" in order ? order.resting.cloid! : order.filled.cloid!,
    pxUp,
    pxDown,
    midPx,
  };
}

/** Tops the account up and starts a TWAP order, returning its identifiers. */
export async function createTWAP(
  client: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>,
  symbol = "SOL",
  side: "buy" | "sell" = "buy",
): Promise<{ a: number; b: boolean; s: string; twapId: number; midPx: string }> {
  // Top-up account
  await topUpPerp(client, "60");

  // Get market data
  const id = symbolConverter.getAssetId(symbol)!;
  const szDecimals = symbolConverter.getSzDecimals(symbol)!;
  const midPx = allMids[symbol];

  // Calculate order parameters
  const sz = formatSize(55 / Number(midPx), szDecimals);

  // Place TWAP order
  const result = await client.twapOrder({
    twap: {
      a: id,
      b: side === "buy",
      s: sz,
      r: false,
      m: 5,
      t: false,
    },
  });

  // Extract TWAP info
  const twapId = result.response.data.status.running.twapId;

  return {
    a: id,
    b: side === "buy",
    s: sz,
    twapId,
    midPx,
  };
}

/** Sends USDC from the main wallet to the client's perp balance. */
export async function topUpPerp(
  client: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>,
  amount: string,
): Promise<void> {
  const mainExchClient = new ExchangeClient({ wallet: MAIN_WALLET!, transport });
  const tempUser =
    "multiSigUser" in client.config_ ? client.config_.multiSigUser : await getWalletAddress(client.config_.wallet);
  await mainExchClient.usdSend({ destination: tempUser, amount });
}

/** Sends a spot token from the main wallet to the client's spot balance. */
export async function topUpSpot(
  client: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>,
  token: "USDC" | "HYPE",
  amount: string,
): Promise<void> {
  const tokenAddresses = {
    USDC: "0xeb62eee3685fc4c43992febcd9e75443",
    HYPE: "0x7317beb7cceed72ef0b346074cc8e7ab",
  } as const;

  const mainExchClient = new ExchangeClient({ wallet: MAIN_WALLET!, transport });
  const tempUser =
    "multiSigUser" in client.config_ ? client.config_.multiSigUser : await getWalletAddress(client.config_.wallet);
  await mainExchClient.spotSend({
    destination: tempUser,
    token: `${token}:${tokenAddresses[token]}`,
    amount,
  });
}

/** Approves a fresh agent wallet for the given principal and returns a client signing as that agent. */
export async function createAgentExchangeClient(
  principalClient: ExchangeClient<ExchangeSingleWalletConfig | ExchangeMultiSigConfig>,
): Promise<{ agentExch: ExchangeClient<ExchangeSingleWalletConfig>; principal: `0x${string}` }> {
  const principal =
    "multiSigUser" in principalClient.config_
      ? principalClient.config_.multiSigUser
      : await getWalletAddress(principalClient.config_.wallet);

  const agentAccount = privateKeyToAccount(generatePrivateKey());
  await principalClient.approveAgent({ agentAddress: agentAccount.address, agentName: null });

  return {
    agentExch: new ExchangeClient({ wallet: agentAccount, transport }),
    principal,
  };
}
