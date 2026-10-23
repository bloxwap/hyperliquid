/**
 * Adversarial bounded-lane schedules: a reference model pins cumulative nonce-window semantics,
 * and cancellation-listener counts detect waking every waiter after every admission.
 */
import { describe, expect, test } from "bun:test";
import {
  admitBounded,
  assertOrderedAllowed,
  reserveDispatch,
} from "../../../src/api/exchange/_methods/_base/_dispatch.ts";
import { drain } from "../../_fakeRuntime.ts";

let laneId = 0;

function random(seed: number): () => number {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

describe("bounded dispatch scaling", () => {
  for (const maxOvertakes of [0, 99]) {
    for (const count of [100, 200, 500]) {
      test(`${count} reverse-ready calls at limit ${maxOvertakes} attach cancellation once per caller`, async () => {
        const key = `scaling-${++laneId}`;
        const limits = { maxOvertakes, maxPending: count };
        const reservations = Array.from({ length: count }, (_, i) => reserveDispatch(key, i + 1, limits));
        const controls = Array.from({ length: count }, () => new AbortController());
        let registrations = 0;
        for (const { signal } of controls) {
          const add = signal.addEventListener.bind(signal);
          signal.addEventListener = (...args: Parameters<AbortSignal["addEventListener"]>): void => {
            if (args[0] === "abort") registrations++;
            add(...args);
          };
        }
        const sent: number[] = [];
        const pending: Promise<void>[] = [];
        for (let i = count - 1; i >= 0; i--) {
          pending.push(
            reservations[i].wait(controls[i].signal).then(() => {
              sent.push(i);
            }),
          );
        }
        await drain();
        if (maxOvertakes === 0) {
          // Replies are all held pending: ordered wire dispatch must not serialize the RTTs.
          expect(sent).toEqual(Array.from({ length: count }, (_, i) => i));
        } else {
          // 99 newer sends consume the oldest nonce's budget; that oldest request then sends.
          expect(sent).toHaveLength(100);
          expect(sent[99]).toBe(0);
        }
        const completed = new Set<number>();
        while (completed.size < count) {
          for (const index of sent) {
            if (completed.has(index)) continue;
            completed.add(index);
            reservations[index].release();
          }
          await drain();
        }
        await Promise.all(pending);
        expect(new Set(sent).size).toBe(count);
        expect(registrations).toBeLessThanOrEqual(count);
        expect(() => assertOrderedAllowed(key)).not.toThrow();
      });
    }
  }

  test("same-turn readiness between queued successors preserves awaited wire order", async () => {
    const key = `same-turn-${++laneId}`;
    const reservations = Array.from({ length: 6 }, (_, i) =>
      reserveDispatch(key, i + 1, { maxOvertakes: 0, maxPending: 6 }),
    );
    const sent: number[] = [];
    const pending = [2, 4, 0, 5, 1, 3].map(async (index) => {
      await reservations[index].wait();
      sent.push(index);
      if (index % 2 === 0) reservations[index].release();
    });
    await Promise.all(pending);
    expect(sent).toEqual([0, 1, 2, 3, 4, 5]);
    for (const reservation of reservations) reservation.release();
  });

  test("new reservations do not inherit old prefix debits and sent zero-limit slots still consume capacity", async () => {
    const key = `append-${++laneId}`;
    const limits = { maxOvertakes: 3, maxPending: 100 };
    const older = Array.from({ length: 20 }, (_, i) => reserveDispatch(key, i + 1, limits));
    const first = reserveDispatch(key, 21, limits);
    await first.wait();
    first.release();
    // The old subtree has deferred overtake debits when this suffix is appended.
    const later = Array.from({ length: 5 }, (_, i) => reserveDispatch(key, i + 22, limits));
    for (const slot of older) slot.release();
    await later[4].wait();
    later[4].release();
    await later[3].wait();
    later[3].release();
    await later[2].wait();
    later[2].release();
    let newestSent = false;
    const blocked = later[1].wait().then(() => {
      newestSent = true;
    });
    await drain();
    expect(newestSent).toBe(false);
    await later[0].wait();
    later[0].release();
    await blocked;
    later[1].release();

    const zeroKey = `zero-capacity-${++laneId}`;
    const zero = { maxOvertakes: 0, maxPending: 1 };
    const pendingResponse = reserveDispatch(zeroKey, 1, zero);
    await pendingResponse.wait();
    expect(() => admitBounded(zeroKey, { mode: "bounded", ...zero })).toThrow("queue is full");
    pendingResponse.release();
    expect(() => admitBounded(zeroKey, { mode: "bounded", ...zero })).not.toThrow();
  });

  for (const maxOvertakes of [0, 1, 3, 99]) {
    test(`mixed readiness, replies, and cancellation agree with the reference model at limit ${maxOvertakes}`, async () => {
      const key = `reference-${++laneId}`;
      const next = random(12345 + maxOvertakes);
      const count = 300;
      const limits = { maxOvertakes, maxPending: count };
      const reservations = Array.from({ length: count }, (_, i) => reserveDispatch(key, i + 1, limits));
      const controls = Array.from({ length: count }, () => new AbortController());
      const model = Array.from({ length: count }, () => ({ ready: false, sent: false, released: false, overtakes: 0 }));
      const expected: number[] = [];
      const actual: number[] = [];
      const pending: Promise<void>[] = [];
      const pump = (): void => {
        for (;;) {
          const candidate = model.findIndex((slot) => slot.ready && !slot.sent && !slot.released);
          if (candidate < 0) return;
          if (
            model.some(
              (slot, i) =>
                i < candidate && !slot.released && slot.overtakes >= maxOvertakes && (!slot.sent || maxOvertakes > 0),
            )
          )
            return;
          model[candidate].sent = true;
          expected.push(candidate);
          for (let i = 0; i < candidate; i++) if (!model[i].released) model[i].overtakes++;
        }
      };
      const release = (index: number): void => {
        model[index].released = true;
        reservations[index].release();
        pump();
      };
      const remaining = Array.from({ length: count }, (_, i) => i);
      while (remaining.length > 0) {
        const index = remaining.splice(Math.floor(next() * remaining.length), 1)[0];
        model[index].ready = true;
        pending.push(
          reservations[index].wait(controls[index].signal).then(
            () => {
              actual.push(index);
            },
            (reason: unknown) => {
              expect(reason).toBe(controls[index].signal.reason);
            },
          ),
        );
        pump();
        await drain();
        expect(actual).toEqual(expected);
        const live = model.flatMap((slot, i) => (slot.sent && !slot.released ? [i] : []));
        if (live.length > 0 && next() < 0.7) release(live[Math.floor(next() * live.length)]);
        if (!model[index].sent && next() < 0.2) {
          controls[index].abort(new Error("cancel queued signature"));
          release(index);
        }
        await drain();
        expect(actual).toEqual(expected);
      }
      while (model.some((slot) => !slot.released)) {
        const index = model.findIndex((slot) => slot.sent && !slot.released);
        expect(index).toBeGreaterThanOrEqual(0);
        release(index);
        await drain();
        expect(actual).toEqual(expected);
      }
      await Promise.all(pending);
      expect(admitBounded(key, { mode: "bounded", ...limits })).toEqual(limits);
      expect(() => assertOrderedAllowed(key)).not.toThrow();
    });
  }
});
