/**
 * Virtual clock and timers for transport tests, injected through the `runtime` options.
 * @module
 */

import type { Runtime, TimerHandle } from "../src/transport/runtime.ts";

/**
 * Isolated virtual clock and timers; never patches platform globals. Wall and monotonic time
 * advance together through {@linkcode FakeRuntime.advance}; {@linkcode FakeRuntime.setWallTime}
 * moves only the wall clock, to simulate corrections. `random()` is 0 unless overridden.
 */
export class FakeRuntime implements Runtime {
  private _wall = 1_700_000_000_000;
  private _elapsed = 0;
  private _id = 0;
  private readonly _timers = new Map<number, { due: number; callback: () => void; interval?: number }>();
  private readonly _random: () => number;
  /** @param options.random Jitter source; defaults to always 0. */
  constructor(options?: { random?: () => number }) {
    this._random = options?.random ?? ((): number => 0);
  }
  now(): number {
    return this._wall;
  }
  monotonicNow(): number {
    return this._elapsed;
  }
  random(): number {
    return this._random();
  }
  /** Timers and intervals scheduled and not yet fired or cancelled. */
  get pendingTimers(): number {
    return this._timers.size;
  }
  /** Moves only the wall clock, as an NTP correction would; monotonic time is unaffected. */
  setWallTime(value: number): void {
    this._wall = value;
  }
  setTimeout(callback: () => void, ms: number): TimerHandle {
    const id = ++this._id;
    this._timers.set(id, { due: this._elapsed + Math.max(0, ms), callback });
    return id;
  }
  clearTimeout(handle: TimerHandle | undefined): void {
    this._timers.delete(handle as number);
  }
  setInterval(callback: () => void, ms: number): TimerHandle {
    const id = this.setTimeout(callback, ms) as number;
    this._timers.get(id)!.interval = Math.max(1, ms);
    return id;
  }
  clearInterval(handle: TimerHandle | undefined): void {
    this.clearTimeout(handle);
  }
  /** Advances to the earliest pending timer and fires it; `false` when none is pending. */
  nextTimer(): boolean {
    const due = Math.min(...[...this._timers.values()].map((timer) => timer.due));
    if (!Number.isFinite(due)) return false;
    this.advance(due - this._elapsed);
    return true;
  }
  /** Advances both clocks by `ms`, firing every timer that falls due, in deadline order. */
  advance(ms: number): void {
    const end = this._elapsed + ms;
    for (let count = 0; ; count++) {
      if (count > 100_000) throw new Error("Virtual timer did not make progress");
      const next = [...this._timers]
        .filter(([, timer]) => timer.due <= end)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this._wall += timer.due - this._elapsed;
      this._elapsed = timer.due;
      if (timer.interval === undefined) this._timers.delete(id);
      else timer.due += timer.interval;
      timer.callback();
    }
    this._wall += end - this._elapsed;
    this._elapsed = end;
  }
}

/** Drain nested nonce-lock/signing reactions without sleeping. */
export async function drain(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}
