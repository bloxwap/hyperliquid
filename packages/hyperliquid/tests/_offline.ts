/**
 * Offline-mode detection for the whole test suite.
 *
 * Tests that talk to a live Hyperliquid endpoint are skipped in offline mode,
 * which is what CI uses as its fast gate. Historically the flag was read from
 * `Deno.args`, but `bun test` consumes every token on its own command line —
 * including the ones after `--` — so inside a test file `process.argv` is
 * always `[<bun>, <test file>]`. The raw command line is therefore recovered
 * from the OS once per process (this module is evaluated a single time and the
 * result is cached in `OFFLINE`), which keeps the documented
 * `bun test tests/ -- --offline` invocation working.
 *
 * @module
 */

import { readFileSync } from "node:fs";

// --- Command line recovery ---------------------------------------------------

/** Returns this process' original command line, or `undefined` if the OS does not expose it. */
function rawCommandLine(): string | undefined {
  try {
    if (process.platform === "linux") {
      // /proc/self/cmdline is NUL-separated, not space-separated.
      return readFileSync("/proc/self/cmdline", "utf8").replaceAll("\0", " ");
    }
    const { exitCode, stdout } = Bun.spawnSync(["ps", "-o", "args=", "-p", String(process.pid)]);
    return exitCode === 0 ? stdout.toString() : undefined;
  } catch {
    return undefined; // no command line available: assume online, same as the Deno behaviour
  }
}

// --- Public API --------------------------------------------------------------

/**
 * `true` when every test that needs a live Hyperliquid endpoint must be skipped.
 *
 * Enabled by `bun test … -- --offline` or by setting `HL_OFFLINE=1`; the env var
 * is the cheaper and more robust switch for scripts and CI.
 */
export const OFFLINE: boolean =
  process.env.HL_OFFLINE === "1" ||
  process.argv.includes("--offline") ||
  /(?:^|\s)--offline(?:\s|$)/.test(rawCommandLine() ?? "");
