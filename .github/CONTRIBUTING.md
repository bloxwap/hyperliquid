# Contributing to @bloxwap/hyperliquid

Welcome, and thank you for taking the time to contribute to the SDK! You can contribute in different ways:

- Submit new features
- Report bugs
- Review code

## Dev Environment Setup

If you want to read or modify the SDK code, set up your development environment as follows:

1. Install [Bun](https://bun.com).
2. Install the dependencies:

   ```bash
   bun install
   ```

3. Install the [Biome extension](https://biomejs.dev/guides/editors/first-party-extensions/) for your editor so
   formatting and linting match CI as you type.

The package `exports` point straight at the TypeScript sources, so there is no build step during development. Only
publishing needs one (`bun run build`, which writes `dist/`).

## Commands

Every task in this repo runs through Bun. There is no other toolchain.

| Command                        | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `bun install`                  | Install dependencies.                                                |
| `bun run check`                | Format, lint, docs, TypeScript 5 + 7, JSDoc sync, export sync.       |
| `bun test tests/`              | Full test suite; the online tests need network and credentials.      |
| `HL_OFFLINE=1 bun test tests/` | Offline gate: skips every live-endpoint test. This is what CI runs.  |
| `bun run perf`                 | Performance suite; prints a table (`--out <path>` writes JSON).      |
| `bun run perf:gate`            | Zero-performance-regression gate (see below).                        |
| `bun run build`                | Emit the publishable package into `dist/`.                           |

`bun run check` is a bundle of narrower scripts (`check:format`, `check:lint`, `check:docs`, `check:types`, `check:ts7`,
`check:jsdoc`, `check:export`) — run one directly when you only want to re-check that dimension. `bun run format` and
`bun run lint` are the `--write` variants of the first two.

## Testing

```bash
bun test tests/
```

Optional: Set `PRIVATE_KEY` env for complete tests. Required testnet balance: ~100 usdc-perps, ~3 usdc-spot, ~0.0000001
hype-spot. If you keep the key in a local `.env` file (Bun auto-loads it), never commit it — `.env` is gitignored, and
a committed funded key will be drained.

Without a key — or without network — run only the tests that never touch live endpoints:

```bash
HL_OFFLINE=1 bun test tests/
```

`HL_OFFLINE=1` (equivalently `bun run test:offline`) is the switch to use, and is what CI runs. A `--offline` argv flag
is also honored: `bun test` does not forward argv to test files, so `tests/_offline.ts` recovers the raw command line
from the OS to support it. That recovery works, but the env var needs none of it, which is why it is the documented path.

## Performance

**This project enforces a zero performance regression policy.** A change may keep performance the same or improve it —
never regress it.

Locally, `bun run perf:gate` enforces that: it runs the suite in `tests/perf/`, compares against the committed baseline
at `tests/perf/results/baseline.json`, and exits non-zero when any scenario got materially slower.

The baseline is **machine-specific**. These scenarios measure between 9 ns and 600 µs per unit, so a different CPU or JS
engine shifts every number by a multiple and swamps the threshold; `.dev/perf/compare.ts` refuses to compare reports
from different environments rather than emit a page of phantom regressions. That is why CI does not use the committed
baseline at all: the Performance workflow measures the base commit and the head commit back to back on the *same*
runner and compares those two reports.

```bash
bun run perf                          # measure and print the table
bun run perf:gate                     # measure, compare to baseline, fail on regression
bun run .dev/perf/gate.ts --record    # re-record the baseline
```

Re-record the baseline only when you intentionally changed what a scenario measures, and do it in the same commit as
that change. If the gate flaps on a busy machine, widen the band with `--threshold <pct>` rather than skipping the gate.

## Coding Guidelines

- **Style**: After making changes, run `bun run check` (format, lint, docs, TypeScript 5 + 7, JSDoc/export sync).
- **Performance**: Zero-regression policy — if you touch a hot path, run `bun run perf:gate` before opening a PR.
- **Dependencies**: Use small and easily auditable dependencies (e.g.
  [@noble/hashes](https://www.npmjs.com/package/@noble/hashes) or [valibot](https://valibot.dev/)).
- **Testing**: Write tests for any new functionality. Keep the offline gate green: a test that needs a live endpoint
  must skip itself when `HL_OFFLINE=1`.
- **Docs**: Update or add JSDoc comments where appropriate.

## Common Tasks

### Add a new API method

1. Create a file named after the method in the matching group's `_methods` directory:
   `src/api/[exchange|info|subscription|explorer]/_methods/[methodName].ts`
2. Implement it using the patterns from existing method files.
3. Re-export the file from the group barrel: add `export * from "./_methods/[methodName].ts";` to
   `src/api/[group]/mod.ts`.
4. Add the matching wrapper method to the client in `src/api/[group]/client.ts`.
5. Create a test at `tests/api/[group]/[methodName].test.ts` (use patterns from other tests) and run it.
6. Run the `bun run check` command and fix any errors that are reported.

### Update API schemas/types

1. Go to `src/api/[group]/_methods/[methodName].ts`
2. Update the [valibot](https://valibot.dev/) schemas in the "Schemas" section (types are inferred from schemas).
3. Run the test at `tests/api/[group]/[methodName].test.ts` to check the schemas against the actual API response.
