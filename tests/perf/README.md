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
(relative margin of error at 95% confidence) is reported so the gate can tell a real change from jitter: a scenario only
counts as regressed when the slowdown exceeds the threshold **plus** both runs' margins of error.

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

### `subscription` — WebSocket fan-out cost

`subscription/l2book_dispatch_50_coins` subscribes 50 coins on one channel, injects 500 frames for **one** coin, and
reports **`invocationsPerTick`**: how many listeners a single frame runs.

|                     | invocationsPerTick                      |
| ------------------- | --------------------------------------- |
| Pre-fix (this tree) | 50 (every listener runs, 49 discard)    |
| Post-fix (expected) | 1 (routed to the matching subscription) |

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
  from another CPU or runtime turns every comparison into noise. `compare.ts` prints a warning when the two reports'
  environments differ.
- [`results/baseline.txt`](results/baseline.txt), `results/baseline_bench.log` and `results/baseline_test.log` are
  historical artifacts: the pre-fix output of the original Deno `bench`/`test` suite this harness replaced. They are kept
  as evidence of the pre-fix numbers and are not read by any tooling.
