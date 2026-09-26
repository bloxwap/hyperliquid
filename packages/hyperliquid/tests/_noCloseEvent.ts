/**
 * Preload for `bun test` (bunfig `[test] preload`): removes the global `CloseEvent`
 * before any test file loads.
 *
 * `src/transport/websocket/_reconnectingSocket.ts` picks its close-event class once,
 * at module evaluation: the runtime's `CloseEvent` when present, a local fallback
 * otherwise. Deleting the global up front makes every module instance in the test
 * process take the fallback branch — the path runtimes without a global `CloseEvent`
 * execute in production — so the whole suite exercises it, instead of a single test
 * re-importing the module into a divergent second instance. The runtime's original
 * class stays available to test fakes as {@linkcode RealCloseEvent}.
 * @module
 */

const stash = globalThis as {
  CloseEvent?: typeof CloseEvent;
  __realCloseEvent?: typeof CloseEvent;
};

stash.__realCloseEvent = stash.CloseEvent;
delete stash.CloseEvent;

const real = stash.__realCloseEvent;
if (real === undefined) throw new Error("CloseEvent was already missing before the preload ran");

/** The runtime's original `CloseEvent`, stashed before removal; for test fakes that dispatch close events. */
export const RealCloseEvent: typeof CloseEvent = real;
