# Connect to Hyperliquid

Every [client](clients.md) reaches Hyperliquid through a transport. Two are built in — [`HttpTransport`](#http) and
[`WebSocketTransport`](#websocket) — and both expose the same request API, so switching between them is a one-line
change.

The choice comes down to [subscriptions](clients.md#websocket-subscriptions): live data streams that only
`WebSocketTransport` can open. If you don't need them, `HttpTransport` is the simpler choice.

## Common options

Both transports take the same two options:

- `isTestnet` — connect to the Hyperliquid testnet instead of mainnet.
- `timeout` — abort a request after this many milliseconds (default `10_000`; pass `null` to disable).

```ts
import { HttpTransport, WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new HttpTransport({ isTestnet: true, timeout: 30_000 });
//                    ^^^^^^^^^^^^^
//                    or `WebSocketTransport`
```

## HTTP

Each request is an independent POST with no connection to keep alive, which suits serverless functions, edge workers,
and unstable networks:

```ts
import { ExchangeClient, HttpTransport, InfoClient } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x...");
const transport = new HttpTransport();

const info = new InfoClient({ transport });
const exchange = new ExchangeClient({ wallet, transport });
//                                            ^^^^^^^^^
//                     A single transport instance can be reused with any client

const mids = await info.allMids();
```

### HTTP endpoints

`HttpTransport` uses two endpoints, both defaulting to Hyperliquid's public URLs (set `isTestnet` to send requests to
the testnet URL):

- `apiUrl` — info and exchange requests. Default: `https://api.hyperliquid.xyz`.
- `rpcUrl` — [explorer](https://app.hyperliquid.xyz/explorer) requests. Default: `https://rpc.hyperliquid.xyz`.

Override either to run against your [own node](https://github.com/hyperliquid-dex/node) or a proxy:

```ts
import { HttpTransport } from "@bloxwap/hyperliquid";

const transport = new HttpTransport({
  apiUrl: "https://custom-api.example.com",
  rpcUrl: "https://custom-rpc.example.com",
});
```

### Fetch options

`fetchOptions` is merged into every request the transport sends, so you can set any
[`RequestInit`](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit) field (except `body` and `method`) — extra
headers, `credentials`, `cache`, and the like:

```ts
import { HttpTransport } from "@bloxwap/hyperliquid";

const transport = new HttpTransport({
  fetchOptions: {
    headers: { "X-Custom-Header": "value" },
  },
});
```

### Exchange timeout

`timeout` covers every request, so a hung `/exchange` POST blocks an order for the full duration. `exchangeTimeout`
gives the exchange endpoint its own — usually shorter — deadline, while info and explorer requests keep the global
one:

```ts
import { HttpTransport } from "@bloxwap/hyperliquid";

const transport = new HttpTransport({
  timeout: 10_000, // info and explorer requests
  exchangeTimeout: 5_000, // order placement, cancels, transfers
});
```

Pass `null` to disable the timeout for exchange requests only. Like `timeout`, the field is mutable on the instance.

### Rate limiting

Hyperliquid budgets REST requests at **1200 weight per minute per IP**; going over yields HTTP 429, and repeated
violations get the IP banned. An exchange request costs `1 + floor(batchLength / 40)` — unbatched actions cost 1, a
batch of 40–79 orders (or cancels) costs 2, 80–119 costs 3. Info endpoints cost 2–60 weight and explorer requests 40
(see [Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) for the full table).

`rateLimit` opts `HttpTransport` into a client-side token bucket paced to that budget: every request acquires its
weight before sending and **waits** while the bucket is empty instead of failing with a 429 after the fact:

```ts
import { HttpTransport } from "@bloxwap/hyperliquid";

const transport = new HttpTransport({
  rateLimit: { capacity: 1200, refillPerMinute: 1200 }, // the defaults, shown for clarity
});
```

The limiter bills the documented weights:

| Request                                                                                                             | Weight                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `info`: `l2Book`, `allMids`, `clearinghouseState`, `orderStatus`, `spotClearinghouseState`, `exchangeStatus`        | 2                                                                                     |
| `info`: any other documented request                                                                                | 20                                                                                    |
| `info`: `userRole`                                                                                                  | 60                                                                                    |
| `explorer`                                                                                                          | 40                                                                                    |
| `exchange`                                                                                                          | `1 + floor(batchLength / 40)`                                                         |

The exchange batch length is read from the action's `orders`/`cancels`/`modifies` array, unwrapping multi-sig
actions (the batch lives inside `action.payload.action`). Those three keys are the documented batch subset — other
actions carry arrays that are not batch-billed (`spotDeploy`/`perpDeploy` payloads, the multi-sig `signatures`
array), so the limiter deliberately does not bill by a generic "first array" rule; whether the protocol's
`batch_length` covers anything more is tracked in [issue #49](https://github.com/bloxwap/hyperliquid/issues/49).

Response-size surcharges can only be known once the response arrives, so they are debited from the bucket **after**
the response: 1 extra weight per 20 returned items on the documented list endpoints (`recentTrades`, `userFills`,
`historicalOrders`, …), per 60 on `candleSnapshot`, and per returned block on explorer `blockList`. Later requests
then wait off the real cost rather than the estimate the request was sent with. Two caveats: the official docs warn
that older `blockList` blocks "may be weighted more heavily" server-side, so the +1-per-block debit is exact only
for recent blocks; and the item-count rule is an interpretation — the docs do not say whether the count is exactly
the top-level response array length (what the limiter bills) nor whether partial chunks round up or down (the
limiter rounds up, the conservative choice). Both are tracked in [issue #49](https://github.com/bloxwap/hyperliquid/issues/49).

- The wait happens before the request timeout is armed, so throttling never trips `timeout` / `exchangeTimeout`;
  aborting the request's signal cancels the wait instead — an aborted request never reaches the wire.
- A request that fails after the wait — even with HTTP 429 — keeps its pre-send weight debit (no refund): the
  server bills attempts, its own accounting of failed requests is undocumented, and keeping the debit is the
  conservative reading.
- The limiter is off by default; without `rateLimit` the transport never delays a request client-side.

**The limiter is per `HttpTransport` instance.** It tracks only the requests it sends itself — other transport
instances, other processes, and other machines behind the same IP do not coordinate, yet they all share the same
1200 weight/minute budget. Treat it as best-effort local throttling, not a guarantee against 429s: bursts that
exceed what one instance can see still hit the server limit, and there is no endpoint that reports the IP bucket's
state. Handle [`HttpRateLimitError`](error-handling.md#httpratelimiterror) (which carries `status` and, when the
server sends a `Retry-After` header, a `retryAfter` hint in seconds) as the backstop.

The separate **address-based** limits (requests allowed per user, growing with cumulative trading volume) are what
the [`userRateLimit`](clients.md) info method reports — it has no view of the shared per-IP weight budget either.

## WebSocket

`WebSocketTransport` opens one connection and reuses it, shaving a little latency off each request and allows using the
subscription API:

```ts
import { SubscriptionClient, WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport();
const subs = new SubscriptionClient({ transport });
//                 ^^^^^^^^^^^^^^^^^^
//                 Unlike other clients, it supports only `WebSocketTransport`

await subs.allMids((data) => {
  console.log(data.mids);
});
// Promise is resolved when the subscription is connected
```

### WebSocket endpoints

Because a WebSocket transport is one open connection, it reaches a single endpoint per instance, unlike `HttpTransport`.
`WebSocketTransport` therefore takes one `url` (default `wss://api.hyperliquid.xyz/ws`) for info, exchange, and
subscriptions; [explorer](https://app.hyperliquid.xyz/explorer) subscriptions need a second transport pointed at
`wss://rpc.hyperliquid.xyz/ws`:

```ts
import { ExplorerClient, WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport({ url: "wss://rpc.hyperliquid.xyz/ws" });
//                                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                            Default value for `url` is `wss://api.hyperliquid.xyz/ws`.
//                            For explorer subscriptions, you need a separate transport pointed at `wss://rpc.hyperliquid.xyz/ws`.
const explorer = new ExplorerClient({ transport });

await explorer.explorerBlock((data) => {
  console.log(data);
});
```

### Reconnection

`WebSocketTransport` reconnects on its own when the connection drops, through the in-house
`ReconnectingWebSocket` (`src/transport/websocket/_reconnectingSocket.ts`) — a minimal WebSocket wrapper with
reconnection logic.

Reconnection defaults, tuned for a latency-critical trading connection:

- **Unbounded retries** — `maxRetries: Infinity`. The socket never silently stops reconnecting; the consecutive-failure
  counter resets once a connection stays open for `stableTimeout` (default `3_000` ms).
- **Backoff** — `reconnectionDelay` defaults to exponential backoff `2 ** attempt * 150` ms with equal jitter (half the
  capped delay is fixed, half uniform random), capped at **10 s**. The cap trades a slightly slower recovery after a
  long outage for not hammering an endpoint that is already struggling; pass a custom delay to change it.
- **Routine rotations reconnect immediately** — a clean close (code 1000, e.g. Hyperliquid's `Expired` connection
  rotation) skips the delay on the first retry of a streak and emits no `error` event; only repeated clean closes fall
  back to the backoff.
- **Handshake bound** — `connectionTimeout` (default `10_000` ms) recycles a stuck connection attempt through the same
  retry policy.

Pass `reconnect` to change the retry count, delay, or connection timeout. See `ReconnectingWebSocketOptions` in the
source for the rest. `transport.close()` (or `socket.close()`) terminates permanently — no further reconnection is
attempted afterwards.

```ts
import { WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport({
  reconnect: { maxRetries: 5, reconnectionDelay: 1_000 },
});
```

### Keep-alive

A ping/pong watchdog detects a half-open connection — one that looks open but no longer carries frames — and forces
a [reconnect](#reconnection). Every `interval` it sends a ping; if no pong arrives within `timeout`, the connection
is recycled.

Defaults are `interval: 5_000` and `timeout: 3_000`, so a dead feed is detected in at most ~8 s. The server closes a
connection that has been silent for ~60 s, so keep the interval well below that. Lower values detect a stale feed
faster at the cost of more ping traffic; raise them on constrained networks.

```ts
import { WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport({
  keepAlive: { interval: 10_000, timeout: 5_000 },
});
```

### Resubscription

The SDK re-subscribes to every active channel on its own after a [reconnect](#reconnection), so you never restore them
by hand. Delivery pauses while the connection is down and resumes once it's back. Turn that off with
`resubscribe: false`:

```ts
const transport = new WebSocketTransport({ resubscribe: false });
```

If a subscription then fails to re-establish, its `onError` callback is invoked. Handle it as shown under
[subscription errors](clients.md#errors).

### WebSocket limits

Hyperliquid scopes every documented WebSocket limit to your **IP address**, not to the connection — two of them say so
in their own text ("across all websocket connections"):

| Limit                                  | Value       | Scope                          |
| -------------------------------------- | ----------- | ------------------------------ |
| Connections                            | 10          | per IP                         |
| New connections                        | 30/minute   | per IP                         |
| Subscriptions                          | 1000        | per IP                         |
| Unique users across user-specific subs | 14          | per IP                         |
| Messages sent to Hyperliquid           | 2000/minute | per IP, across all connections |
| Simultaneous inflight post requests    | 100         | per IP, across all connections |

Because that scope is the IP and not the socket, every `WebSocketTransport` on a network **shares one budget** by
default, and the subscription and unique-user guards count what the server counts. Two transports no longer admit 2000
subscriptions against a limit of 1000 — the excess is refused locally with a clear
[`WebSocketRequestError`](error-handling.md) instead of by the server, whose refusal carries no echoed request and
therefore surfaces only as a request timeout ten seconds later.

Reservations are released when a subscription is unsubscribed or when its connection is permanently closed, which is
when the server frees them too. Call `transport.close()` on a transport you are done with.

Pass your own `quota` when the default's assumption does not hold — a process behind several egress IPs needs one per
IP, and tests usually want isolation. Pass `rateLimit` to keep the default's [message pacing](#websocket-rate-limiting)
on the replacement; a `WebSocketQuota` constructed without it is accounting-only:

```ts
import { WebSocketQuota, WebSocketTransport } from "@bloxwap/hyperliquid";

const transport = new WebSocketTransport({ quota: new WebSocketQuota({ rateLimit: {} }) });
```

### WebSocket rate limiting

Outbound messages are **paced by default**: the shared quota runs a token bucket sized to the server's budget (capacity
2000, refilling 2000/minute), because the default transport is exactly the one that trips the limit — one reconnect
re-subscribes every held subscription at once, so 1000 subscriptions spend half the minute's budget instantly, and a
flapping socket repeats the burst until the server refuses.

Pacing only ever delays `subscribe` and `unsubscribe` frames. **`post` requests and keep-alive pings never wait**: an
exchange action's wire order — and therefore per-wallet nonce ordering — depends on reaching the socket synchronously,
and delaying the keep-alive watchdog is how a half-open connection goes unnoticed. Both still *debit* the budget, so a
burst of orders correctly slows subscription traffic rather than silently overrunning the shared limit.

To opt out of pacing — or to resize the bucket — pass your own `quota`; constructed without `rateLimit`, it keeps the
subscription and unique-user guards but never delays a frame client-side:

```ts
import { WebSocketQuota, WebSocketTransport } from "@bloxwap/hyperliquid";

// Accounting only: nothing waits client-side.
const transport = new WebSocketTransport({ quota: new WebSocketQuota() });

// Or keep pacing with a custom burst size and refill rate.
const paced = new WebSocketTransport({
  quota: new WebSocketQuota({ rateLimit: { capacity: 1000, refillPerMinute: 2000 } }),
});
```

As with [HTTP rate limiting](#rate-limiting), the budget is client-side bookkeeping: other processes, other machines
behind the same IP, and traffic the SDK cannot see all draw on the same server-side bucket.
