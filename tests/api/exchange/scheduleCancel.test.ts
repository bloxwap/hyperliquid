import { ApiRequestError, ValidationError } from "@bloxwap/hyperliquid";
import {
  type ScheduleCancelParameters,
  ScheduleCancelRequest,
  scheduleCancel,
} from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { afterEach, describe, test } from "bun:test";
import { assertEquals, assertRejects, assertThrows } from "@jsr/std__assert";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const paramsSchema = valibotToJsonSchema(v.omit(v.object(ScheduleCancelRequest.entries.action.entries), ["type"]));

runTest({
  name: "scheduleCancel",
  codeTestFn: async (_t, exchClient) => {
    const params: ScheduleCancelParameters[] = [
      // time=defined
      { time: Date.now() + 30000 },
      // time=missing
      {},
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(
          async () => {
            await exchClient.scheduleCancel(p);
          },
          ApiRequestError,
          "Cannot set scheduled cancel time until enough volume traded",
        ),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});

// ============================================================
// Offline: the scheduled time must be at least 5 seconds in the future (compared against
// `Date.now()` at call time, so these tests freeze the clock), and `time: null` means "unset"
// ============================================================

const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

const FROZEN = 1_700_000_000_000;
const realDateNow = Date.now;

afterEach(() => {
  Date.now = realDateNow;
});

/** Creates a transport stub that records posted payloads and resolves with a success response. */
function recordingTransport(): { transport: IRequestTransport; payloads: { action: Record<string, unknown> }[] } {
  const payloads: { action: Record<string, unknown> }[] = [];
  const transport: IRequestTransport = {
    isTestnet: true,
    request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
      payloads.push(payload as { action: Record<string, unknown> });
      return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
    },
  };
  return { transport, payloads };
}

describe("scheduleCancel (offline)", () => {
  test("time exactly 5 seconds in the future passes", async () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    await scheduleCancel({ transport, wallet }, { time: FROZEN + 5_000 });

    assertEquals(payloads[0].action.time, FROZEN + 5_000);
  });

  test("time more than 5 seconds in the future passes", async () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    await scheduleCancel({ transport, wallet }, { time: FROZEN + 30_000 });

    assertEquals(payloads.length, 1);
  });

  test("time less than 5 seconds in the future is rejected before sending", () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    assertThrows(
      () => scheduleCancel({ transport, wallet }, { time: FROZEN + 4_999 }),
      ValidationError,
      "at least 5 seconds in the future",
    );
    assertThrows(
      () => scheduleCancel({ transport, wallet }, { time: FROZEN }),
      ValidationError,
      "at least 5 seconds in the future",
    );
    assertEquals(payloads.length, 0);
  });

  test("the guard also runs on the skipValidation path", () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    assertThrows(
      () => scheduleCancel({ transport, wallet }, { time: FROZEN + 4_999 }, { skipValidation: true }),
      ValidationError,
      "at least 5 seconds in the future",
    );
    assertEquals(payloads.length, 0);
  });

  test("time: null is treated as unset (python SDK parity)", async () => {
    const { transport, payloads } = recordingTransport();

    await scheduleCancel({ transport, wallet }, { time: null });

    assertEquals("time" in payloads[0].action, false);
  });

  test("omitted time posts an action without the time key", async () => {
    const { transport, payloads } = recordingTransport();

    await scheduleCancel({ transport, wallet });

    assertEquals("time" in payloads[0].action, false);
  });
});
