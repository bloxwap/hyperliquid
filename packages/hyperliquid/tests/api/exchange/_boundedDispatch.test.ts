/**
 * Tests for the optional bounded dispatch policy of `executeWithShell`.
 *
 * The exchange keeps each signer's 100 highest nonces and accepts a request whose nonce is unused
 * and above the smallest of them. Every transport here models that set and asserts both rules at
 * the moment a request arrives, so a policy that let an outstanding nonce fall out of the window
 * fails the test rather than an order in production. Time comes from an injected `FakeRuntime`
 * (`config.runtime`), and nonces from a counter, so ordering and window checks are deterministic.
 * @module
 */

import { describe, expect, test } from "bun:test";

import { signAction, submitAction } from "../../../src/actions/execution.ts";
import { buildOrder } from "../../../src/actions/order.ts";
import type { ExchangeConfig } from "../../../src/api/exchange/_methods/_base/_config.ts";
import { type BuildResult, executeWithShell } from "../../../src/api/exchange/_methods/_base/_shell.ts";
import { prepareRequest } from "../../../src/api/exchange/_methods/prepareRequest.ts";
import { submitPrepared } from "../../../src/api/exchange/_methods/submitPrepared.ts";
import { WebSocketTransport } from "../../../src/transport/websocket/mod.ts";
import { drain, FakeRuntime } from "../../_fakeRuntime.ts";
import { FakeSocket } from "../../_fakeSocket.ts";

// ============================================================
// Helpers
// ============================================================

/** Simulated server nonce set: the signer's 100 highest accepted nonces. */
class ServerNonces {
  readonly set: Set<number>;
  constructor(first: number) {
    // Pre-filled with 100 earlier requests, so the window is already full.
    this.set = new Set(Array.from({ length: 100 }, (_, i) => first - 100 + i));
  }
  /** Applies the exchange's acceptance rule, failing the test on a reused or out-of-window nonce. */
  accept(nonce: number): void {
    expect(this.set.has(nonce)).toBe(false);
    expect(nonce).toBeGreaterThan(Math.min(...this.set));
    this.set.add(nonce);
    if (this.set.size > 100) this.set.delete(Math.min(...this.set));
  }
}

const OK = { status: "ok", response: { type: "default" } };
const SIGNATURE = `0x${"11".repeat(64)}1b` as const;
const built: BuildResult = { action: { type: "test" }, signature: { r: "0x1", s: "0x2", v: 27 } };
const order = (): ReturnType<typeof buildOrder> =>
  buildOrder({ orders: [{ a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" } } }] });

let walletId = 100;
function nextAddress(): `0x${string}` {
  return `0x${(++walletId).toString(16).padStart(40, "0")}`;
}

interface Harness {
  config: ExchangeConfig;
  /** Nonces in the order they reached the transport. */
  nonces: number[];
  clock: FakeRuntime;
  /** Nonces handed out by the nonce manager, sent or not. */
  allocated: () => number;
}

function harness(maxOvertakes = 99): Harness {
  const clock = new FakeRuntime();
  const nonces: number[] = [];
  let nonce = clock.now();
  const first = nonce;
  const server = new ServerNonces(nonce);
  const config: ExchangeConfig = {
    wallet: { address: nextAddress(), signTypedData: async () => SIGNATURE },
    runtime: clock,
    nonceManager: () => nonce++,
    dispatchPolicy: { mode: "bounded", maxOvertakes },
    transport: {
      isTestnet: true,
      request: async <T>(_endpoint: "info" | "exchange", body: unknown): Promise<T> => {
        const received = (body as { nonce: number }).nonce;
        server.accept(received);
        nonces.push(received);
        return OK as T;
      },
    },
  };
  return { config, nonces, clock, allocated: () => nonce - first };
}

/** A build callback that resolves only when the returned `release` is called. */
function stalled(): { build: () => Promise<BuildResult>; release: (result?: BuildResult) => void } {
  let resolve!: (result: BuildResult) => void;
  const promise = new Promise<BuildResult>((r) => {
    resolve = r;
  });
  return { build: () => promise, release: (result = built) => resolve(result) };
}

/** Deterministic PRNG (mulberry32), so the randomized schedules are reproducible. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Tests
// ============================================================

describe("bounded dispatch", () => {
  test("ready signatures may overtake one stalled signature, but cumulative overtaking stops at 99", async () => {
    const { config, nonces } = harness();
    const slow = stalled();
    const first = executeWithShell(config, slow.build);
    await drain();
    // 120 newer requests against a full 100-nonce window: only 99 may go ahead of the stalled one.
    const requests = Array.from({ length: 120 }, () => executeWithShell(config, async () => built));
    await Promise.all(requests.slice(0, 99));
    await drain();
    expect(nonces).toHaveLength(99);
    slow.release();
    await Promise.all([first, ...requests]);
    const firstNonce = Math.min(...nonces);
    expect(nonces.indexOf(firstNonce)).toBe(99);
    expect(new Set(nonces).size).toBe(121);
  });

  test("randomized signing and network latency never push an outstanding nonce out of the window", async () => {
    for (const seed of [1, 2, 3]) {
      const clock = new FakeRuntime();
      const next = random(seed);
      let nonce = clock.now();
      const server = new ServerNonces(nonce);
      let arrived = 0;
      const config: ExchangeConfig = {
        wallet: { address: nextAddress(), signTypedData: async () => SIGNATURE },
        runtime: clock,
        nonceManager: () => nonce++,
        dispatchPolicy: { mode: "bounded" },
        transport: {
          isTestnet: true,
          // The server sees each request after its own random network delay, so requests sent in
          // one order can arrive in another: the bound must hold for arrival order too.
          request: <T>(_endpoint: "info" | "exchange", body: unknown): Promise<T> =>
            new Promise((resolve) => {
              clock.setTimeout(
                () => {
                  server.accept((body as { nonce: number }).nonce);
                  arrived++;
                  resolve(OK as T);
                },
                Math.floor(next() * 50),
              );
            }),
        },
      };
      // Mostly fast signatures, with a few that stall for far longer than 100 others take.
      const requests = Array.from({ length: 400 }, () =>
        executeWithShell(
          config,
          () =>
            new Promise<BuildResult>((resolve) => {
              const roll = next();
              clock.setTimeout(() => resolve(built), roll < 0.02 ? 2_000 : Math.floor(roll * 20));
            }),
        ),
      );
      await drain();
      while (clock.nextTimer()) await drain();
      await Promise.all(requests);
      expect(arrived).toBe(400);
    }
  });

  test("transport completion does not erase earlier pending nonce overtaking history", async () => {
    const { config, nonces } = harness(2);
    const slow = stalled();
    const first = executeWithShell(config, slow.build);
    await drain();
    await executeWithShell(config, async () => built);
    await executeWithShell(config, async () => built);
    const blocked = executeWithShell(config, async () => built);
    await drain();
    expect(nonces).toHaveLength(2);
    slow.release();
    await Promise.all([first, blocked]);
    expect(nonces).toHaveLength(4);
  });

  test("maxOvertakes 0 dispatches in nonce order", async () => {
    const { config, nonces } = harness(0);
    const slow = stalled();
    const first = executeWithShell(config, slow.build);
    await drain();
    const later = Array.from({ length: 3 }, () => executeWithShell(config, async () => built));
    await drain();
    expect(nonces).toHaveLength(0);
    slow.release();
    await Promise.all([first, ...later]);
    expect(nonces).toEqual([...nonces].sort((a, b) => a - b));
  });

  test("ready requests waiting for the window are sent oldest first", async () => {
    const { config, nonces } = harness(1);
    const slow = stalled();
    const first = executeWithShell(config, slow.build);
    await drain();
    await executeWithShell(config, async () => built);
    // The window is spent; three more finish signing newest first and wait.
    const signers = [stalled(), stalled(), stalled()];
    const waiting = signers.map((signer) => executeWithShell(config, signer.build));
    await drain();
    for (const signer of signers.toReversed()) {
      signer.release();
      await drain();
    }
    expect(nonces).toHaveLength(1);
    slow.release();
    await Promise.all([first, ...waiting]);
    const sent = nonces.slice(2);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
  });

  test("cancelling a stalled signer releases the window and late signing never posts", async () => {
    const { config, nonces } = harness(1);
    const abort = new AbortController();
    const slow = stalled();
    const first = executeWithShell(config, slow.build, abort.signal).catch((e: unknown) => e);
    await drain();
    const second = executeWithShell(config, async () => built);
    const third = executeWithShell(config, async () => built);
    await drain();
    expect(nonces).toHaveLength(1);
    abort.abort(new Error("stop signer"));
    expect(await first).toBe(abort.signal.reason);
    await Promise.all([second, third]);
    slow.release();
    await drain();
    expect(nonces).toHaveLength(2);
  });

  test("cancelling a request waiting for its turn settles it without posting", async () => {
    const { config, nonces } = harness(0);
    const slow = stalled();
    const first = executeWithShell(config, slow.build);
    await drain();
    const abort = new AbortController();
    const waiting = executeWithShell(config, async () => built, abort.signal).catch((e: unknown) => e);
    await drain();
    abort.abort(new Error("stop waiting"));
    expect(await waiting).toBe(abort.signal.reason);
    slow.release();
    await first;
    expect(nonces).toHaveLength(1);
  });

  test("the protocol timestamp window is checked again at dispatch, in both directions", async () => {
    const { config, clock, nonces } = harness();
    const slow = stalled();
    const held = executeWithShell(config, slow.build).catch((e: unknown) => e);
    await drain();
    // Waited past two days behind its own signature.
    clock.advance(172_800_000);
    slow.release();
    expect(String(await held)).toContain("timestamp window");

    const future = { ...config, nonceManager: () => clock.now() + 86_400_000 };
    await expect(executeWithShell(future, async () => built)).rejects.toThrow("timestamp window");
    expect(nonces).toHaveLength(0);
    // Rejections released their slots: a fresh, in-window request goes through.
    await executeWithShell({ ...config, nonceManager: () => clock.now() }, async () => built);
    expect(nonces).toHaveLength(1);
  });

  test("mixed policies and detached preparation are rejected", async () => {
    const { config } = harness();
    const slow = stalled();
    const held = executeWithShell(config, slow.build);
    await drain();
    await expect(executeWithShell({ ...config, dispatchPolicy: "ordered" }, async () => built)).rejects.toThrow(
      "same bounded",
    );
    await expect(executeWithShell({ ...config, dispatchPolicy: undefined }, async () => built)).rejects.toThrow(
      "same bounded",
    );
    await expect(
      executeWithShell({ ...config, dispatchPolicy: { mode: "bounded", maxOvertakes: 5 } }, async () => built),
    ).rejects.toThrow("does not match");
    await expect(prepareRequest(config, async () => {})).rejects.toThrow("managed execute");
    await expect(signAction(config, order())).rejects.toThrow("managed execute");
    await expect(submitAction(config, {} as never)).rejects.toThrow();
    slow.release();
    await held;
  });

  test("a bounded call is rejected while ordered calls for the signer are still being dispatched", async () => {
    const { config } = harness();
    const slow = stalled();
    const ordered = executeWithShell({ ...config, dispatchPolicy: "ordered" }, slow.build);
    await drain();
    await expect(executeWithShell(config, async () => built)).rejects.toThrow("Cannot mix");
    slow.release();
    await ordered;
    // The ordered chain is idle again, so bounded calls are accepted.
    await executeWithShell(config, async () => built);
  });

  test("detached submission checks the original signer even through another client's configuration", async () => {
    const { config } = harness();
    const signed = await signAction({ ...config, dispatchPolicy: "ordered" }, order());
    const slow = stalled();
    const held = executeWithShell(config, slow.build);
    await drain();
    const other = harness().config;
    await expect(submitAction({ ...other, dispatchPolicy: "ordered" }, signed)).rejects.toThrow("managed execute");
    await expect(submitPrepared({ ...other, dispatchPolicy: "ordered" }, signed)).rejects.toThrow("managed execute");
    slow.release();
    await held;
    // Once the lane has drained, the signed request may be submitted under the default policy.
    await submitAction({ ...config, dispatchPolicy: "ordered" }, signed);
  });

  test("policy rejections are raised before a nonce is allocated", async () => {
    const { config, allocated } = harness(0);
    config.dispatchPolicy = { mode: "bounded", maxOvertakes: 0, maxPending: 1 };
    const slow = stalled();
    const held = executeWithShell(config, slow.build);
    await drain();
    expect(allocated()).toBe(1);
    await expect(executeWithShell(config, async () => built)).rejects.toThrow("queue is full");
    await expect(executeWithShell({ ...config, dispatchPolicy: "ordered" }, async () => built)).rejects.toThrow(
      "same bounded",
    );
    await expect(signAction({ ...config, dispatchPolicy: "ordered" }, order())).rejects.toThrow("managed execute");
    await expect(
      executeWithShell({ ...config, dispatchPolicy: { mode: "bounded", maxOvertakes: 100 } }, async () => built),
    ).rejects.toThrow(RangeError);
    expect(allocated()).toBe(1);
    slow.release();
    await held;
  });

  test("queue limits, failed signatures, and expiry release bounded state", async () => {
    const { config, nonces, clock } = harness(0);
    config.dispatchPolicy = { mode: "bounded", maxOvertakes: 0, maxPending: 1 };
    const slow = stalled();
    const held = executeWithShell(config, slow.build);
    await drain();
    await expect(executeWithShell(config, async () => built)).rejects.toThrow("queue is full");
    slow.release();
    await held;
    await expect(
      executeWithShell(config, async () => {
        throw new Error("wallet rejected");
      }),
    ).rejects.toThrow("wallet rejected");
    await expect(
      executeWithShell(config, async () => ({ ...built, extras: { expiresAfter: clock.now() - 1 } })),
    ).rejects.toThrow("expired");
    await executeWithShell(config, async () => built);
    expect(nonces).toHaveLength(2);
  });

  test("closing the transport settles signing, waiting, and in-flight requests and releases the lane", async () => {
    const clock = new FakeRuntime();
    const posted: number[] = [];
    // Never answers a post, so a sent request stays in flight until the socket closes.
    const socket = new FakeSocket((data) => {
      const frame = JSON.parse(data);
      if (frame.method === "post") posted.push(frame.request.payload.nonce);
    });
    const ws = new WebSocketTransport({
      isTestnet: true,
      runtime: clock,
      timeout: null,
      reconnect: { maxRetries: 0 },
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    await drain();
    socket.open();
    await drain();
    let nonce = clock.now();
    const config: ExchangeConfig = {
      wallet: { address: nextAddress(), signTypedData: async () => SIGNATURE },
      runtime: clock,
      nonceManager: () => nonce++,
      dispatchPolicy: { mode: "bounded", maxOvertakes: 1 },
      transport: ws,
    };
    const slow = stalled();
    const signing = executeWithShell(config, slow.build).catch((e: unknown) => e);
    await drain();
    const inFlight = executeWithShell(config, async () => built).catch((e: unknown) => e);
    await drain();
    const waiting = executeWithShell(config, async () => built).catch((e: unknown) => e);
    await drain();
    expect(posted).toHaveLength(1);

    ws.close();
    expect(await inFlight).toBeInstanceOf(Error);
    slow.release();
    expect(await signing).toBeInstanceOf(Error);
    expect(await waiting).toBeInstanceOf(Error);
    expect(posted).toHaveLength(1);

    // Every slot was released: the same signer may switch back to the default policy.
    const nonces: number[] = [];
    await executeWithShell(
      {
        ...config,
        dispatchPolicy: "ordered",
        transport: {
          isTestnet: true,
          request: async <T>(_endpoint: "info" | "exchange", body: unknown): Promise<T> => {
            nonces.push((body as { nonce: number }).nonce);
            return OK as T;
          },
        },
      },
      async () => built,
    );
    expect(nonces).toHaveLength(1);
    clock.advance(60_000);
    expect(clock.pendingTimers).toBe(0);
  });

  test("the default policy is unchanged when dispatchPolicy is omitted", async () => {
    const { config, nonces } = harness();
    const ordered = { ...config, dispatchPolicy: undefined };
    const slow = stalled();
    const first = executeWithShell(ordered, slow.build);
    await drain();
    const later = Array.from({ length: 3 }, () => executeWithShell(ordered, async () => built));
    await drain();
    expect(nonces).toHaveLength(0);
    slow.release();
    await Promise.all([first, ...later]);
    expect(nonces).toEqual([...nonces].sort((a, b) => a - b));
  });
});
