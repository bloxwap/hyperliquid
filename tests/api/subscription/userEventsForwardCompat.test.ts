/**
 * Forward-compatibility tests for the server-extensible `userEvents` union.
 *
 * Hyperliquid adds user event variants server-side without notice. The `UserEventsEvent` union
 * ends in an opaque {@linkcode UnknownUserEvent} catch-all so that an unrecognized variant:
 * - still type-checks (it is a valid `UserEventsEvent`), and
 * - reaches the listener with its raw payload untouched.
 *
 * The type-level assertions below are verified by `tsc` (the whole tests/ tree is type-checked);
 * the runtime assertions verify that the payload passes through the listener unmodified.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import type { UserFillsResponse } from "@bloxwap/hyperliquid/api/info";
import type { UnknownUserEvent, UserEventsEvent } from "@bloxwap/hyperliquid/api/subscription";

// ============================================================
// Type-level assertions (checked by tsc, not at runtime)
// ============================================================

/** A variant the SDK does not know about, as the server would send it. */
const unknownVariant = { brandNewVariant: { someField: "value", another: 42 } };

// An unknown-variant payload type-checks into the catch-all.
const unknownEvent: UserEventsEvent = unknownVariant;
const unknownCatchAll: UnknownUserEvent = unknownVariant;

// A known variant still type-checks as before.
const fillsEvent: UserEventsEvent = {
  fills: [
    {
      coin: "ETH",
      px: "3000.0",
      sz: "1.0",
      side: "B",
      time: 1700000000000,
      startPosition: "0.0",
      dir: "Open Long",
      closedPnl: "0.0",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      oid: 1,
      crossed: true,
      fee: "0.1",
      tid: 1,
      feeToken: "USDC",
      twapId: null,
    },
  ],
};

// Known variants keep full narrowing: `"fills" in event` resolves `event.fills` to exactly
// `UserFillsResponse` — not `UserFillsResponse | undefined`, not `unknown`.
// (Never invoked: a function body is type-checked without running at test time.)
export function knownVariantKeepsFullNarrowing(event: UserEventsEvent): void {
  if ("fills" in event) {
    const fills: UserFillsResponse = event.fills;
    void fills;
  }
}

// After every known variant is excluded, the remainder is exactly the catch-all.
function remainder(e: UserEventsEvent): UnknownUserEvent {
  if ("fills" in e) return e;
  if ("funding" in e) return e;
  if ("liquidation" in e) return e;
  if ("nonUserCancel" in e) return e;
  if ("twapHistory" in e) return e;
  if ("twapSliceFills" in e) return e;
  return e;
}

// The catch-all does not absorb known variants when extracting them.
type FillsVariant = Extract<UserEventsEvent, { fills: unknown }>;
const extractedFills: FillsVariant = { fills: [] };
// @ts-expect-error — the catch-all is not part of the extracted known variant
const extractedNotCatchAll: FillsVariant = { brandNewVariant: {} };

// The catch-all member alone rejects nothing that is an object, but is not a known variant.
// @ts-expect-error — an unknown variant is not assignable to a known variant
const notFills: { fills: UserFillsResponse } = unknownVariant;

// ============================================================
// Runtime assertions
// ============================================================

describe("userEvents forward compatibility", () => {
  test("an unknown variant reaches the listener with its payload untouched", () => {
    // The transport dispatches frames without validating them against the union; the same
    // object the server sent must come out the other side.
    const received: UserEventsEvent[] = [];
    const listener: (data: UserEventsEvent) => void = (data) => received.push(data);

    listener(unknownEvent);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(unknownVariant);
    expect(Object.keys(received[0])).toEqual(["brandNewVariant"]);
  });

  test("known variants are distinguishable from the catch-all at runtime", () => {
    expect("fills" in fillsEvent).toBe(true);
    expect("fills" in unknownEvent).toBe(false);
    expect(remainder(unknownEvent)).toBe(unknownVariant);
  });

  test("type-level exports are usable", () => {
    expect(unknownCatchAll).toBe(unknownVariant);
    expect(extractedFills).toEqual({ fills: [] });
    expect(notFills).toBeDefined();
    expect(extractedNotCatchAll).toBeDefined();
    expect(typeof knownVariantKeepsFullNarrowing).toBe("function");
  });
});
