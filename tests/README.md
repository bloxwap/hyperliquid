# Tests

Test suite for the SDK, run with `bun test`.

## Layout

| Directory          | Covers                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| `tests/api/`       | The four API clients (info, exchange, explorer, subscription) and their schemas. |
| `tests/signing/`   | Signing: canonicalization, digests, msgpack, keccak, multi-sig, wallets.     |
| `tests/transport/` | HTTP and WebSocket transports, plus abort, rate limiting, caching, redaction. |
| `tests/utils/`     | Symbol conversion and decimal formatting.                                    |
| `tests/perf/`      | Offline performance suite with its own README, harness, and regression gate. |

## Running

```sh
# Whole suite (tests that need live Hyperliquid endpoints require network access)
bun test tests/

# Offline mode: skip every test that talks to a live endpoint (what CI gates on)
HL_OFFLINE=1 bun test tests/

# Performance suite: human-readable table, and the zero-regression gate
bun run perf
bun run perf:gate
```

`test` and `test:offline` in `package.json` are the same invocations as the first two commands above.

## Conventions

Shared harnesses live at the top level of `tests/` and are prefixed with `_`:

- `_testContext.ts` — minimal stand-in for `Deno.TestContext`; harnesses hand callbacks a `TestContext` whose
  `step()` runs sub-steps inline and prefixes failures with the step path.
- `_offline.ts` — offline-mode detection. `OFFLINE` is `true` when `HL_OFFLINE=1` is set or `--offline` appears on
  the command line (recovered from the OS, because `bun test` does not forward argv to test files). Tests that need a
  live endpoint must consult it and skip.
- `_noCloseEvent.ts` — `bun test` preload (configured in `bunfig.toml`) that deletes the global `CloseEvent` before any
  test file loads, so the whole suite exercises the WebSocket transport's fallback close-event class. The runtime's
  original class stays available to test fakes as `RealCloseEvent`.

The performance suite under `tests/perf/` has its own harness (`_harness.ts`), mock transports (`_helpers.ts`), and
fixtures (`_fixtures.ts`); see `tests/perf/README.md` for its methodology and the baseline-recording workflow.
