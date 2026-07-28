/**
 * Per-channel routing keys for Hyperliquid subscription frames.
 *
 * A channel is shared by every subscription that uses it: fifty `l2Book` coins all arrive under
 * `channel: "l2Book"`. Dispatching by channel name alone therefore runs every listener on the
 * channel and lets each one decide, so K subscriptions cost K invocations per frame. A *route key*
 * is the discriminator a subscription would have filtered on, derived from both sides of the wire —
 * the subscribe payload and the frame body — so a frame can be delivered only to the subscriptions
 * that asked for it.
 *
 * The rules this table lives by:
 * - The two shapes differ per channel (`l2Book` frames carry `coin`, `trades` frames carry an array
 *   whose first element does, `candle` frames call it `s`), so every entry mirrors the comparison
 *   its counterpart in `src/api/subscription/_methods/` actually performs.
 * - A channel absent from the table is broadcast, and so is a *payload* the key cannot be read
 *   from. Routing too little costs a redundant listener call that the method's own filter discards;
 *   routing too much would silently hand a caller another coin's book. Only the first is acceptable.
 * - Keys may be looser than the method's filter, never stricter: `BY_USER` folds address case
 *   because addresses are case-insensitive, while the filter compares with `===` and drops the
 *   mismatch afterwards.
 * - A *frame* the key cannot be read from goes out on the bare channel only, so it reaches the
 *   subscriptions that could not be keyed but not the keyed ones. That is not a loss: every route
 *   here reads a field its channel's filter also requires, so a frame missing it is a frame the
 *   filter discarded before this table existed.
 *
 * @module
 */

/** Reads a route key from one side of the wire; `undefined` means "this value cannot be keyed". */
type KeyReader = (value: unknown) => string | undefined;

/** How one channel derives its route key from a subscribe payload and from a frame body. */
interface ChannelRoute {
  /** Route key of a subscribe payload. */
  fromPayload: KeyReader;
  /** Route key of a frame body. */
  fromEvent: KeyReader;
}

/** Reads `value[key]`, or `undefined` when `value` is not an object. */
function prop(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Reads `value[key]` when it is a string, `undefined` otherwise. */
function stringProp(value: unknown, key: string): string | undefined {
  const read = prop(value, key);
  return typeof read === "string" ? read : undefined;
}

/**
 * Matches any uppercase ASCII letter: the gate that lets a case-folding reader skip its
 * `toLowerCase` — and the fresh string it allocates — when the value is already lowercase, which
 * server-sent hex addresses virtually always are.
 */
const HAS_UPPERCASE = /[A-Z]/;

/** Case-folds a user-reading key reader, allocating only when an uppercase char actually occurs. */
function caseFolded(reader: KeyReader): KeyReader {
  return (value: unknown): string | undefined => {
    const key = reader(value);
    return key === undefined || !HAS_UPPERCASE.test(key) ? key : key.toLowerCase();
  };
}

/** Route key of a payload's `coin`. */
const payloadCoin: KeyReader = (payload: unknown): string | undefined => stringProp(payload, "coin");

/** Route key of a payload's `user`, case-folded because addresses are case-insensitive. */
const payloadUser: KeyReader = caseFolded((payload: unknown): string | undefined => stringProp(payload, "user"));

/** `payload.coin` against `data.coin`: the shape most asset channels use. */
const BY_COIN: ChannelRoute = {
  fromPayload: payloadCoin,
  fromEvent: (data: unknown): string | undefined => stringProp(data, "coin"),
};

/** `payload.user` against `data.user`. */
const BY_USER: ChannelRoute = {
  fromPayload: payloadUser,
  fromEvent: caseFolded((data: unknown): string | undefined => stringProp(data, "user")),
};

/**
 * `candle.ts`: `e.detail.s === payload.coin && e.detail.i === payload.interval`. The interval is
 * left to the filter, so two intervals of one coin share a route.
 */
const BY_CANDLE_COIN: ChannelRoute = {
  fromPayload: payloadCoin,
  fromEvent: (data: unknown): string | undefined => stringProp(data, "s"),
};

/** `trades.ts`: `e.detail[0]?.coin === payload.coin` — the frame is an array of one coin's trades. */
const BY_TRADES_COIN: ChannelRoute = {
  fromPayload: payloadCoin,
  fromEvent: (data: unknown): string | undefined => (Array.isArray(data) ? stringProp(data[0], "coin") : undefined),
};

/** `webData3.ts`: `e.detail.userState.user === payload.user`. */
const BY_USER_STATE: ChannelRoute = {
  fromPayload: payloadUser,
  fromEvent: caseFolded((data: unknown): string | undefined => stringProp(prop(data, "userState"), "user")),
};

/**
 * Route per channel, keyed by channel name.
 *
 * Channels deliberately absent — they are broadcast, and must stay that way:
 * `allMids`, `assetCtxs`, `spotAssetCtxs`, `allDexsAssetCtxs` (keyed on an optional `dex` whose
 * absent and empty forms are not distinguishable in the frame), `fastAssetCtxs` (compressed body),
 * and `notification`, `orderUpdates`, `outcomeMetaUpdates`, `userEvents` (the subscribed `user` is
 * not part of the frame at all). The transport's own `subscriptionResponse`, `post`, `error`, `pong`
 * and `explorer*_` channels are broadcast for the same reason.
 */
const ROUTES: Map<string, ChannelRoute> = new Map([
  // --- Coin channels ---------------------------------------------------------
  ["activeAssetCtx", BY_COIN], //     activeAssetCtx.ts:     e.detail.coin === payload.coin
  ["activeSpotAssetCtx", BY_COIN], // activeSpotAssetCtx.ts: e.detail.coin === payload.coin
  ["bbo", BY_COIN], //                bbo.ts:                e.detail.coin === payload.coin
  ["l2Book", BY_COIN], //             l2Book.ts:             e.detail.coin === payload.coin
  // activeAssetData.ts compares the coin *and* the user; the coin alone routes, the filter still
  // checks the user, so a shared coin costs at most one extra discarded call.
  ["activeAssetData", BY_COIN],
  ["candle", BY_CANDLE_COIN],
  ["trades", BY_TRADES_COIN],
  // --- User channels ---------------------------------------------------------
  ["allDexsClearinghouseState", BY_USER], //   e.detail.user === payload.user
  ["spotState", BY_USER], //                   e.detail.user === payload.user
  ["userFills", BY_USER], //                   e.detail.user === payload.user
  ["userFundings", BY_USER], //                e.detail.user === payload.user
  ["userHistoricalOrders", BY_USER], //        e.detail.user === payload.user
  ["userNonFundingLedgerUpdates", BY_USER], // e.detail.user === payload.user
  ["userTwapHistory", BY_USER], //             e.detail.user === payload.user
  ["userTwapSliceFills", BY_USER], //          e.detail.user === payload.user
  // These compare the user *and* the dex; the user alone routes, the filter checks the dex.
  ["clearinghouseState", BY_USER],
  ["openOrders", BY_USER],
  ["twapStates", BY_USER],
  ["webData3", BY_USER_STATE],
]);

/**
 * Separates a channel from its route key in an event type.
 *
 * `NUL` cannot occur in a channel name or in any Hyperliquid key (coins and addresses are
 * printable), so a routed type can never collide with a bare channel name.
 */
const KEY_SEPARATOR = "\u0000";

/**
 * True when `eventType` is a bare channel name rather than a routed type.
 *
 * @example
 * ```ts ignore
 * isBareChannel("l2Book"); // => true
 * isBareChannel("l2Book\0BTC"); // => false
 * ```
 */
export function isBareChannel(eventType: string): boolean {
  return !eventType.includes(KEY_SEPARATOR);
}

/**
 * Event type a subscription for `payload` must listen on: the routed type when the channel is
 * routed and the payload carries its discriminator, the bare channel otherwise.
 *
 * @example
 * ```ts ignore
 * payloadEventType("l2Book", { type: "l2Book", coin: "BTC" }); // => "l2Book\0BTC"
 * payloadEventType("allMids", { type: "allMids" }); // => "allMids"
 * ```
 */
export function payloadEventType(channel: string, payload: unknown): string {
  const route = ROUTES.get(channel);
  if (route === undefined) return channel;
  const key = route.fromPayload(payload);
  return key === undefined ? channel : channel + KEY_SEPARATOR + key;
}

/**
 * Interned routed types, `channel → key → routedType`: repeat frames on one route reuse a single
 * string instead of allocating `channel + KEY_SEPARATOR + key` per frame, and the shared identity
 * also speeds the listener-map hashing the routed type feeds into. Keys are bounded by the
 * coins/users actually seen on the wire, so no eviction is needed.
 */
const ROUTED_TYPES: Map<string, Map<string, string>> = new Map();

/** The interned routed type of `channel` + `key`. */
function internRoutedType(channel: string, key: string): string {
  let byKey = ROUTED_TYPES.get(channel);
  if (byKey === undefined) {
    byKey = new Map();
    ROUTED_TYPES.set(channel, byKey);
  }
  let routed = byKey.get(key);
  if (routed === undefined) {
    routed = channel + KEY_SEPARATOR + key;
    byKey.set(key, routed);
  }
  return routed;
}

/**
 * Routed event type of an incoming frame, or `undefined` when the frame carries no route key and
 * must be broadcast on its channel instead.
 *
 * @example
 * ```ts ignore
 * frameEventType("l2Book", { coin: "BTC", levels: [] }); // => "l2Book\0BTC"
 * frameEventType("allMids", { mids: {} }); // => undefined
 * ```
 */
export function frameEventType(channel: string, data: unknown): string | undefined {
  const route = ROUTES.get(channel);
  if (route === undefined) return undefined;
  const key = route.fromEvent(data);
  return key === undefined ? undefined : internRoutedType(channel, key);
}
