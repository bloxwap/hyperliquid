import { activeAssetCtx } from "@bloxwap/hyperliquid/api/subscription/activeAssetCtx";
import { allMids } from "@bloxwap/hyperliquid/api/subscription/allMids";
import { candle } from "@bloxwap/hyperliquid/api/subscription/candle";
import { l2Book } from "@bloxwap/hyperliquid/api/subscription/l2Book";
import { trades } from "@bloxwap/hyperliquid/api/subscription/trades";
import type { SubscriptionOptions } from "@bloxwap/hyperliquid/api/subscription";
import type { ISubscriptionTransport } from "@bloxwap/hyperliquid/transport";

export { WebSocketTransport } from "@bloxwap/hyperliquid/transport/websocket";

/** The playground's SDK code is an interaction-only chunk, limited to its five feeds. */
export function subscribeMarketFeed(
  transport: ISubscriptionTransport,
  coin: string,
  feed: "allMids" | "l2Book" | "trades" | "candle" | "activeAssetCtx",
  receive: (data: unknown) => void,
  options: SubscriptionOptions,
) {
  const config = { transport };
  if (feed === "allMids") {
    return allMids(
      config,
      {},
      (data) => {
        if (data.mids[coin] !== undefined) receive({ coin, midPx: data.mids[coin] });
      },
      options,
    );
  }
  if (feed === "l2Book") return l2Book(config, { coin }, receive, options);
  if (feed === "trades") return trades(config, { coin }, receive, options);
  if (feed === "candle") return candle(config, { coin, interval: "1m" }, receive, options);
  return activeAssetCtx(config, { coin }, receive, options);
}
