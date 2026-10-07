/**
 * Optional bounded dispatch coordination per `(signer × network)`.
 *
 * The exchange accepts any unused nonce above the smallest of the signer's 100 highest nonces, so
 * a later nonce may reach it before an earlier one. What it will not accept is an earlier nonce
 * that 100 newer ones have already pushed out of that set. A lane therefore counts, for every
 * outstanding request, how many newer requests were dispatched ahead of it, and holds further
 * newer requests once that count reaches `maxOvertakes` (at most 99). The count is cumulative
 * until the older request settles — a cap on simultaneous requests alone would let newer requests
 * keep finishing, releasing their slots, and overtaking it indefinitely. A request counts until its
 * response settles, not just until it is sent, so the bound holds even when requests arrive in a
 * different order than they were sent.
 *
 * @module
 */

import { HyperliquidError } from "../../../../_base.ts";
import { race } from "../../../../transport/_abort.ts";

/**
 * How signed requests for one signer/network reach the transport.
 *
 * - `"ordered"` (default): requests are dispatched in nonce-issuance order; a slow signature delays
 *   every later request for the same signer.
 * - `{ mode: "bounded" }`: a ready signature may be dispatched before a slower earlier one, while
 *   no outstanding request is overtaken by more newer requests than the exchange's nonce window
 *   tolerates. Supported by managed execution only, for a signer whose nonces this process owns.
 */
export type DispatchPolicy =
  | "ordered"
  | {
      mode: "bounded";
      /** Maximum newer requests dispatched ahead of any outstanding request, in `[0, 99]`. Default: `99`. */
      maxOvertakes?: number;
      /** Maximum signing, waiting, and in-flight requests for this signer/network. Default: `1000`. */
      maxPending?: number;
    };

/** A bounded policy with its defaults applied. */
export interface BoundedLimits {
  maxOvertakes: number;
  maxPending: number;
}

/** One request from nonce reservation until its response (or failure) settles. */
interface Slot {
  nonce: number;
  /** Newer requests dispatched while this one was outstanding. */
  overtakes: number;
  /** Signed and waiting for its turn. */
  ready: boolean;
  sent: boolean;
}

/** Shared state of every bounded request outstanding for one signer/network. */
interface Lane extends BoundedLimits {
  slots: Set<Slot>;
  latestNonce: number;
  /** Resolves on the next admission or release; waiters re-check their own condition. */
  changed: Promise<void>;
  wake: () => void;
}

/** Active lanes per `(walletAddress × isTestnet)` key; a lane is dropped once its last slot releases. */
const lanes = new Map<string, Lane>();

/** Reservation of one nonce in a bounded lane. */
export interface DispatchReservation {
  /** Resolves once this request may be handed to the transport, then counts it as an overtake. */
  wait(signal?: AbortSignal): Promise<void>;
  /** Frees the slot; idempotent. Call once the request has settled or will never be sent. */
  release(): void;
}

/**
 * Whether a detached request under `policy` needs the signer-specific check: in bounded mode, or
 * while any bounded lane is active. Lets callers skip resolving the signer address otherwise.
 */
export function needsDetachedCheck(policy?: DispatchPolicy): boolean {
  return typeof policy === "object" || lanes.size > 0;
}

/** Rejects detached signing and submission in bounded mode or while a bounded lane is active. */
export function assertDetachedAllowed(key: string, policy?: DispatchPolicy): void {
  if (typeof policy === "object" || lanes.has(key)) {
    throw new HyperliquidError(
      "Bounded dispatch supports managed execute calls only; detached signing/prepared submission is unavailable",
    );
  }
}

/** Rejects an ordered call while bounded calls for the same signer/network are outstanding. */
export function assertOrderedAllowed(key: string): void {
  if (lanes.size > 0 && lanes.has(key)) {
    throw new HyperliquidError("All active calls for this signer/network must use the same bounded dispatch policy");
  }
}

/**
 * Validates a bounded policy and checks that the lane can take one more request, without changing
 * any state. Called under the nonce lock BEFORE a nonce is allocated, so a rejected call consumes
 * no nonce.
 */
export function admitBounded(key: string, policy: Exclude<DispatchPolicy, string>): BoundedLimits {
  const { maxOvertakes = 99, maxPending = 1000 } = policy;
  if (
    policy.mode !== "bounded" ||
    !Number.isSafeInteger(maxOvertakes) ||
    maxOvertakes < 0 ||
    maxOvertakes > 99 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1
  ) {
    throw new RangeError("Bounded dispatch requires maxOvertakes in [0, 99] and a positive integer maxPending");
  }
  const lane = lanes.get(key);
  if (lane !== undefined) {
    if (lane.maxOvertakes !== maxOvertakes || lane.maxPending !== maxPending) {
      throw new HyperliquidError("Active signer/network dispatch policy does not match this call");
    }
    if (lane.slots.size >= maxPending) throw new HyperliquidError("Bounded dispatch queue is full");
  }
  return { maxOvertakes, maxPending };
}

function resetWake(lane: Lane): void {
  lane.changed = new Promise<void>((resolve) => {
    lane.wake = resolve;
  });
}

function notify(lane: Lane): void {
  lane.wake();
  resetWake(lane);
}

/**
 * Reserves `nonce` in the lane, under the same nonce lock as {@linkcode admitBounded}. The slot is
 * kept after dispatch until {@linkcode DispatchReservation.release}, because a sent request can
 * still arrive after newer ones.
 *
 * @throws {HyperliquidError} When a custom nonce manager returned a nonce that does not exceed the
 * lane's previous one; that nonce is consumed by the manager but never sent.
 */
export function reserveDispatch(key: string, nonce: number, limits: BoundedLimits): DispatchReservation {
  let lane = lanes.get(key);
  if (!Number.isSafeInteger(nonce) || nonce < 0 || (lane !== undefined && nonce <= lane.latestNonce)) {
    throw new HyperliquidError("Bounded dispatch requires strictly increasing unique nonces");
  }
  if (lane === undefined) {
    lane = { ...limits, slots: new Set(), latestNonce: -1, changed: Promise.resolve(), wake: (): void => {} };
    resetWake(lane);
    lanes.set(key, lane);
  }
  lane.latestNonce = nonce;
  const slot: Slot = { nonce, overtakes: 0, ready: false, sent: false };
  lane.slots.add(slot);
  const active = lane;
  const { maxOvertakes } = limits;
  let released = false;
  const canSend = (): boolean => {
    for (const older of active.slots) {
      if (older.nonce >= nonce) continue;
      // A sent request keeps counting until it settles, since it can still arrive after newer ones.
      // With `maxOvertakes: 0` a sent predecessor no longer blocks, which reproduces ordered dispatch.
      if (older.overtakes >= maxOvertakes && (!older.sent || maxOvertakes > 0)) return false;
      // Among ready requests the older goes first. Anything blocking it also blocks this one, so this
      // never delays this request past the wake-up that admits the older one, and it spares the
      // older one an overtake.
      if (older.ready && !older.sent) return false;
    }
    return true;
  };
  return {
    async wait(signal?: AbortSignal): Promise<void> {
      slot.ready = true;
      while (!canSend()) await race(active.changed, signal);
      if (signal?.aborted) throw signal.reason;
      // Admission is synchronous from the check above to here, so concurrent ready requests cannot
      // all observe the same remaining window and oversubscribe it.
      slot.sent = true;
      for (const older of active.slots) if (older.nonce < nonce) older.overtakes++;
      notify(active);
    },
    release(): void {
      if (released) return;
      released = true;
      active.slots.delete(slot);
      notify(active);
      if (active.slots.size === 0 && lanes.get(key) === active) lanes.delete(key);
    },
  };
}
