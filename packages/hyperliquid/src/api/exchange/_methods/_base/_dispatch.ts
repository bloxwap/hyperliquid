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

/** One reservation in the nonce-ordered treap, retained until its response settles. */
interface Slot {
  nonce: number;
  /** Remaining newer sends allowed while this request is outstanding. */
  credit: number;
  /** Lazy credit decrement shared by this entire subtree. */
  pendingOvertakes: number;
  /** Minimum remaining credit in this subtree. */
  minCredit: number;
  /** Earliest ready, unsent request in this subtree. */
  firstReady?: Slot;
  /** Pseudorandom heap order, independent of the nonce value. */
  priority: number;
  left?: Slot;
  right?: Slot;
  waiter?: Waiter;
}

interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Shared state of every bounded request outstanding for one signer/network. */
interface Lane extends BoundedLimits {
  root?: Slot;
  /** Includes sent zero-overtake requests, which need no remaining tree constraint. */
  size: number;
  latestNonce: number;
  /** Deterministic xorshift state: increasing reservations receive independent heap priorities. */
  priorityState: number;
  /** One deferred drain coalesces ready signatures that arrive in the same turn. */
  scheduled: boolean;
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
    if (lane.size >= maxPending) throw new HyperliquidError("Bounded dispatch queue is full");
  }
  return { maxOvertakes, maxPending };
}

/** Apply one or more newer sends to an entire older subtree in constant time. */
function overtake(slot: Slot | undefined, count: number): void {
  if (slot === undefined) return;
  slot.credit -= count;
  slot.minCredit -= count;
  slot.pendingOvertakes += count;
}

/** Materialize a subtree's deferred credit updates before descending into it. */
function push(slot: Slot): void {
  if (slot.pendingOvertakes === 0) return;
  overtake(slot.left, slot.pendingOvertakes);
  overtake(slot.right, slot.pendingOvertakes);
  slot.pendingOvertakes = 0;
}

/** Refresh the two indexes used by the scheduler after a structural or readiness change. */
function pull(slot: Slot): Slot {
  slot.minCredit = Math.min(slot.credit, slot.left?.minCredit ?? Infinity, slot.right?.minCredit ?? Infinity);
  slot.firstReady = slot.left?.firstReady ?? (slot.waiter === undefined ? undefined : slot) ?? slot.right?.firstReady;
  return slot;
}

/** Merge disjoint nonce ranges, preserving their treap heap order. */
function merge(left: Slot | undefined, right: Slot | undefined): Slot | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (left.priority < right.priority) {
    push(left);
    left.right = merge(left.right, right);
    return pull(left);
  }
  push(right);
  right.left = merge(left, right.left);
  return pull(right);
}

/** Remove one reservation, visiting only its search path. */
function remove(root: Slot, nonce: number): Slot | undefined {
  push(root);
  if (nonce === root.nonce) {
    const remaining = merge(root.left, root.right);
    // A retained reservation must not retain the rest of its old lane after release/send.
    root.left = root.right = root.firstReady = undefined;
    return remaining;
  }
  if (nonce < root.nonce) root.left = remove(root.left!, nonce);
  else root.right = remove(root.right!, nonce);
  return pull(root);
}

/** Refresh the ready index after a wait starts or is cancelled. */
function refresh(root: Slot, nonce: number): void {
  push(root);
  if (nonce < root.nonce) refresh(root.left!, nonce);
  else if (nonce > root.nonce) refresh(root.right!, nonce);
  pull(root);
}

/** Whether an older outstanding request has exhausted its cumulative overtake budget. */
function blockedBefore(root: Slot | undefined, nonce: number): boolean {
  if (root === undefined || root.minCredit > 0) return false;
  push(root);
  if (root.nonce >= nonce) return blockedBefore(root.left, nonce);
  if (root.credit === 0 || root.left?.minCredit === 0) return true;
  return blockedBefore(root.right, nonce);
}

/** Charge every older reservation for this send without walking that whole prefix. */
function send(root: Slot, nonce: number): void {
  push(root);
  if (nonce < root.nonce) send(root.left!, nonce);
  else {
    overtake(root.left, 1);
    if (nonce > root.nonce) {
      root.credit--;
      send(root.right!, nonce);
    }
  }
  pull(root);
}

/** Detach a queued caller's cancellation listener exactly once. */
function detach(waiter: Waiter): void {
  if (waiter.onAbort !== undefined) waiter.signal!.removeEventListener("abort", waiter.onAbort);
}

/**
 * Admit only the earliest ready request. If it is blocked by an older exhausted reservation,
 * every later ready request is blocked too. Prefix credit updates and tree indexes cost expected
 * O(log n) per send; no shared promise wakes unrelated waiters. Sent requests with zero allowed
 * overtakes leave the tree immediately, reproducing ordered dispatch without waiting for replies.
 */
function drain(lane: Lane): void {
  for (;;) {
    const slot = lane.root?.firstReady;
    if (slot === undefined || blockedBefore(lane.root, slot.nonce)) return;
    const waiter = slot.waiter!;
    slot.waiter = undefined;
    if (lane.maxOvertakes === 0) lane.root = remove(lane.root!, slot.nonce);
    else send(lane.root!, slot.nonce);
    detach(waiter);
    waiter.resolve();
  }
}

/** Let awaiting callers attach before resolving successors; coalesce same-turn readiness. */
function scheduleDrain(lane: Lane): void {
  if (lane.scheduled) return;
  lane.scheduled = true;
  queueMicrotask(() => {
    lane.scheduled = false;
    drain(lane);
  });
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
    lane = { ...limits, size: 0, latestNonce: -1, priorityState: 0x9e3779b9, scheduled: false };
    lanes.set(key, lane);
  }
  lane.latestNonce = nonce;
  let priority = lane.priorityState;
  priority ^= priority << 13;
  priority ^= priority >>> 17;
  priority ^= priority << 5;
  lane.priorityState = priority >>> 0;
  const slot: Slot = {
    nonce,
    credit: limits.maxOvertakes,
    pendingOvertakes: 0,
    minCredit: limits.maxOvertakes,
    priority: lane.priorityState,
  };
  // Nonces are strictly increasing, so an append is a treap merge, not a key search.
  lane.root = merge(lane.root, slot);
  lane.size++;
  let active: Lane | undefined = lane;
  let released = false;
  let sent = false;
  let waiting: Promise<void> | undefined;
  return {
    wait(signal?: AbortSignal): Promise<void> {
      if (waiting !== undefined) return waiting;
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (released) return Promise.reject(new HyperliquidError("Dispatch reservation was released"));
      const owner = active!;
      const firstReady = owner.root?.firstReady;
      if ((firstReady === undefined || firstReady.nonce > nonce) && !blockedBefore(owner.root, nonce)) {
        // Uncontended admissions need neither a waiter nor an abort listener. Dispatch marking
        // stays synchronous; successors resume only after this caller has attached its await.
        sent = true;
        if (owner.maxOvertakes === 0) owner.root = remove(owner.root!, nonce);
        else send(owner.root!, nonce);
        waiting = Promise.resolve();
        if (owner.root?.firstReady !== undefined) scheduleDrain(owner);
        return waiting;
      }
      waiting = new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          resolve: (): void => {
            sent = true;
            resolve();
          },
          reject,
          signal,
        };
        slot.waiter = waiter;
        if (signal !== undefined) {
          const onAbort = (): void => {
            if (slot.waiter !== waiter) return;
            slot.waiter = undefined;
            detach(waiter);
            refresh(owner.root!, nonce);
            reject(signal.reason);
            scheduleDrain(owner);
          };
          waiter.onAbort = onAbort;
          signal.addEventListener("abort", onAbort, { once: true });
        }
        refresh(owner.root!, nonce);
        scheduleDrain(owner);
      });
      return waiting;
    },
    release(): void {
      if (released) return;
      released = true;
      const owner = active!;
      active = undefined;
      const waiter = slot.waiter;
      slot.waiter = undefined;
      if (waiter !== undefined) {
        detach(waiter);
        waiter.reject(new HyperliquidError("Dispatch reservation was released"));
      }
      if (!sent || owner.maxOvertakes > 0) owner.root = remove(owner.root!, nonce);
      owner.size--;
      drain(owner);
      if (owner.size === 0 && lanes.get(key) === owner) lanes.delete(key);
    },
  };
}
