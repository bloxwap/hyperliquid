# Performance suite

Offline performance measurements for the SDK. Every scenario runs against in-memory mocks
([`_helpers.ts`](_helpers.ts)) and fixed payload fixtures ([`_fixtures.ts`](_fixtures.ts)): no network access at run
time, no clock skew, no server variance. Two runs of the same code differ only by machine noise.

## Running

```sh
# The whole suite, human-readable table only
bun run perf

# Machine-readable report as well
bun run perf -- --out tests/perf/results/current.json

# One group or one scenario while iterating (matches group or name substring)
bun run perf -- --filter signing
bun run perf -- --filter order_100_concurrent

# The regression gate: measure, compare against the committed baseline, fail on a regression
bun run perf:gate

# Re-record the baseline (do it on the machine that runs the gate, in the same commit)
bun run .dev/perf/gate.ts --record

# The robustness test (expected to FAIL until the fastAssetCtxs queue bug is fixed)
bun test tests/perf/
```

## Layout

| File                    | Role                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| `_harness.ts`           | Measurement core: `scenario()` registration, sampling, percentiles, `rme`.         |
| `run.ts`                | Entry point: runs scenarios, prints the table, writes the `PerfReport` JSON.       |
| `_helpers.ts`           | Mock transports and the fake global `WebSocket`.                                   |
| `_fixtures.ts`          | Deterministic, mainnet-sized Info payloads.                                        |
| `scenarios/*.ts`        | The scenarios themselves, one module per group.                                    |
| `.dev/perf/compare.ts`  | Baseline vs. current comparison; also usable directly on two report files.         |
| `.dev/perf/gate.ts`     | One-command gate: run the suite, compare, exit non-zero on a regression.           |

## Methodology

Each scenario runs discarded warmup samples, then measured ones; a sample times `iterations` calls of the body and
divides. The headline statistic is the **median** per-unit time, because benchmark noise on a developer machine is
one-sided (scheduler preemption, GC, thermal) — the mean drifts upward with outliers while the median stays put. `rme`
(the Student-t 95% margin of the sample *mean*) is reported as a sampling-noise magnitude. The gate aggregates paired
rounds with a median ± max-deviation band, and a scenario only counts as regressed when the whole band clears the
threshold plus both sides' margins — an intentionally conservative heuristic, not a confidence interval.

Timings are normalized per *unit* (order, level, mid, frame, request…), so a batch scenario is directly comparable to
its single-item counterpart.

## What is measured

### `signing` — signing-path CPU cost

`canonicalize`, `createL1ActionHash`, `signL1Action` and `signMultiSigL1` called directly, at batch sizes 1 and 100.
Several costs on this path scale with the number of orders in the action, and a per-order regression is invisible at
batch size 1.

### `transaction` — end-to-end `ExchangeClient` throughput

The whole path a caller experiences: validate → lock → nonce → sign → dispatch → validate response.

`transaction/order_100_concurrent` reports **`maxInFlight`**, the peak number of simultaneous transport requests, which
is where per-wallet lock scope shows up:

|                     | maxInFlight                                                | per order   |
| ------------------- | ---------------------------------------------------------- | ----------- |
| Pre-fix             | 1 (per-wallet semaphore wraps signing **and** the request) | ~20 ms      |
| Post-fix (this tree)| ~100                                                       | ~hundreds of µs |

> [!IMPORTANT]
>
> **Do not compare `order_100_concurrent`'s per-order figure against `order_sequential`.** It runs at
> `LATENCY_MS = 20` while `order_sequential` runs at 0, and the harness divides the whole burst's wall time by 100 —
> so **200 µs/order of the figure is amortized round trip** before any SDK cost is counted. The scenario now reports
> `latencyMs` and `rttPerOrderUs` in its `extra` column so the arithmetic is visible without opening the file.
>
> Read `order_100_concurrent` for `maxInFlight` — the wire-overlap guard it was written to be — and read
> **`transaction/order_100_concurrent_instant`** (same shape, 0 ms latency) for per-order SDK CPU. That one is
> directly comparable to `order_sequential`, and measures *lower*: concurrency is slightly cheaper per order, not 3×
> more expensive. Four independent audits have each "discovered" a phantom 200 µs regression here.
>
> `order_100_concurrent_instant` reports `maxInFlight=1`, which is also correct rather than a lock regression: a
> zero-latency transport resolves on a microtask, so each order settles before the next signature finishes. The calls
> are still concurrent through validate → lock → nonce → sign, which is what that scenario measures.

### `subscription` — WebSocket fan-out cost

`subscription/l2book_dispatch_50_coins` subscribes 50 coins on one channel, injects 500 frames for **one** coin, and
reports **`invocationsPerTick`**: how many listeners a single frame runs.

|                     | invocationsPerTick                      |
| ------------------- | --------------------------------------- |
| Pre-fix (this tree) | 50 (every listener runs, 49 discard)    |
| Post-fix (expected) | 1 (routed to the matching subscription) |

`subscription/*_frame_dispatch_e2e` times a raw frame's full path — socket JSON text through parse and routing to the
subscribed listener — for `l2Book` and for the three user-account channels a balance feed lives on:
`clearinghouseState`, `spotState`, and `webData3` (`scenarios/user_account_channels.ts`). `subscription/user_dispatch_15_users`
crowds the maximum allowed 15 users onto one channel and asserts a frame for one user still runs exactly one listener
(the `BY_USER` route); `subscription/subscribe_user_trio` measures establishing the three account subscriptions a feed
makes at session start and on every reconnect.

### `data` — inbound Info-response cost

`InfoClient` reads (`l2Book`, `allMids`, `clearinghouseState`, `metaAndAssetCtxs`) over a transport that answers from a
pre-serialized fixture, normalized per element. Response types in this SDK are type-only — there is no runtime schema
pass inbound — so the measured cost is request validation, client plumbing, and the JSON decode a real transport does.

### `utils` — symbol lookups and decimal formatting

`SymbolConverter.getAssetId` / `getSzDecimals` / `getSpotPairId` over a fixture universe, plus `formatPrice` and
`formatSize`. The cheapest group in the suite, and therefore the one where a small regression is still legible.

### `transport` — per-request transport overhead

`HttpTransport.request` against a stubbed `fetch` (with and without a caller `AbortSignal`, so the abort relay's cost is
attributable) and a `WebSocketTransport.request` round trip through the dispatcher against the mock socket.

### `fast_asset_ctxs.test.ts` — delivery-queue robustness (test, not a scenario)

`fastAssetCtxs` events are base64 + raw-DEFLATE payloads decompressed through a sequential promise queue. The test
subscribes with a listener that throws on the 2nd message, sends 5 messages, and asserts messages 3–5 still arrive.

|                     | result                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| Pre-fix (this tree) | **FAILS** — the throw rejects the shared queue, later messages are dropped |
| Post-fix (expected) | passes                                                                     |

Pre-fix, the dead queue also produces an unhandled rejection, and Bun's test runner fails a test on an unhandled
rejection unconditionally — so the reported failure is `error: listener boom` and the assertion is never reached. Both
symptoms have the same cause; a fix that isolates listener errors per message removes both.

## Notes

- The mock WebSocket is installed over `globalThis.WebSocket` (picked up by `ReconnectingWebSocket`) and auto-answers
  `subscriptionResponse` confirmations and `post` responses like the real server. Server frames are injected via
  `socket.serverSend(...)`.
- The mock exchange transport records every call and its concurrency high-water mark; responses mimic the real `order`
  success payload.
- The test wallet is a viem local account from the well-known test key also used by `tests/signing/`.
- Baselines are machine-specific. `results/baseline.json` must be recorded on the machine that runs the gate; a baseline
  from another CPU or runtime turns every comparison into noise. `compare.ts` and `gate.ts` refuse to compare reports
  from different environments — a hard error, overridable with `--allow-environment-mismatch`.
- Every report carries a **suite fingerprint**: a hash of the suite's source files (`scenarios/*.ts`, `_fixtures.ts`,
  `_helpers.ts`, `_harness.ts`, `run.ts`). The gate fails closed when it differs between the two revisions — a PR that
  edits anything under `tests/perf` changes the workload being compared and is flagged for explicit review rather than
  waved through. Reports recorded before fingerprinting trip a presence-parity check; `--allow-unfingerprinted-base`
  excuses ONLY a pre-fingerprint base (never a current side that dropped fingerprints), and the fix is to re-record
  the baseline / merge a fingerprinted base.
- [`results/baseline.txt`](results/baseline.txt), `results/baseline_bench.log` and `results/baseline_test.log` are
  historical artifacts: the pre-fix output of the original Deno `bench`/`test` suite this harness replaced. They are kept
  as evidence of the pre-fix numbers and are not read by any tooling.
