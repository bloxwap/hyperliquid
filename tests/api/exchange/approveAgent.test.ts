import { type ApproveAgentParameters, ApproveAgentRequest, approveAgent } from "@bloxwap/hyperliquid/api/exchange";
import * as v from "valibot";
import { afterEach, describe, test } from "bun:test";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { ValidationError } from "@bloxwap/hyperliquid";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/exchange/_methods/approveAgent.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "ApproveAgentSuccessResponse");
const paramsSchema = valibotToJsonSchema(
  v.omit(v.object(ApproveAgentRequest.entries.action.entries), [
    "type",
    "signatureChainId",
    "hyperliquidChain",
    "nonce",
  ]),
);

runTest({
  name: "approveAgent",
  codeTestFn: async (_t, exchClient) => {
    // agentName=string
    const withName = await (async () => {
      const params: ApproveAgentParameters = {
        agentAddress: randomAddress(),
        agentName: "agentName",
      };
      return { params, result: await exchClient.approveAgent(params) };
    })();

    await new Promise((r) => setTimeout(r, 5000)); // waiting to avoid error `ApiRequestError: User has pending agent removal`

    // agentName=null
    const withoutName = await (async () => {
      const params: ApproveAgentParameters = {
        agentAddress: randomAddress(),
        agentName: null,
      };
      return { params, result: await exchClient.approveAgent(params) };
    })();

    await new Promise((r) => setTimeout(r, 5000)); // waiting to avoid error `ApiRequestError: User has pending agent removal`

    // agentName=string (with expiration timestamp)
    const withExpiration = await (async () => {
      const expirationTimestamp = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now
      const params: ApproveAgentParameters = {
        agentAddress: randomAddress(),
        agentName: `test valid_until ${expirationTimestamp}`,
      };
      return { params, result: await exchClient.approveAgent(params) };
    })();

    await new Promise((r) => setTimeout(r, 5000)); // waiting to avoid error `ApiRequestError: User has pending agent removal`

    // agentName=missing
    const withoutNameMissing = await (async () => {
      const params: ApproveAgentParameters = {
        agentAddress: randomAddress(),
      };
      return { params, result: await exchClient.approveAgent(params) };
    })();

    const data = [withName, withoutName, withExpiration, withoutNameMissing];

    schemaCoverage(
      paramsSchema,
      data.map((d) => d.params),
    );
    schemaCoverage(
      responseSchema,
      data.map((d) => d.result),
    );
  },
});

function randomAddress(): `0x${string}` {
  return `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}

// ============================================================
// Offline: an unnamed agent is signed with `agentName: ""` but the key is omitted from the wire
// ============================================================

const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

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

describe("approveAgent (offline)", () => {
  test("posted action omits agentName when the agent is unnamed", async () => {
    const unnamed: ApproveAgentParameters[] = [
      { agentAddress: randomAddress() },
      {
        agentAddress: randomAddress(),
        agentName: null,
      },
    ];

    for (const params of unnamed) {
      const { transport, payloads } = recordingTransport();
      await approveAgent({ transport, wallet, signatureChainId: "0x66eee" }, params);
      assertEquals("agentName" in payloads[0].action, false);
    }
  });

  test("posted action includes agentName when the agent is named", async () => {
    const { transport, payloads } = recordingTransport();

    await approveAgent(
      { transport, wallet, signatureChainId: "0x66eee" },
      { agentAddress: randomAddress(), agentName: "myAgent" },
    );

    assertEquals(payloads[0].action.agentName, "myAgent");
  });

  test("posted multi-sig wrapper omits agentName from the inner action when unnamed", async () => {
    const { transport, payloads } = recordingTransport();

    await approveAgent(
      {
        transport,
        signers: [wallet],
        multiSigUser: "0x0000000000000000000000000000000000000001",
        signatureChainId: "0x66eee",
      },
      { agentAddress: randomAddress() },
    );

    const wrapper = payloads[0].action;
    assertEquals(wrapper.type, "multiSig");
    const inner = (wrapper.payload as Record<string, unknown>).action as Record<string, unknown>;
    assertEquals("agentName" in inner, false);
  });
});

// ============================================================
// Offline: a `valid_until` expiration can be at most 180 days in the future (compared against
// `Date.now()` at call time, so these tests freeze the clock); no expiration is not guarded
// ============================================================

const FROZEN = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const realDateNow = Date.now;

afterEach(() => {
  Date.now = realDateNow;
});

describe("approveAgent expiration guard (offline)", () => {
  test("valid_until exactly 180 days in the future passes", async () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    await approveAgent(
      { transport, wallet, signatureChainId: "0x66eee" },
      { agentAddress: randomAddress(), agentName: `agent valid_until ${FROZEN + 180 * DAY_MS}` },
    );

    assertEquals(payloads.length, 1);
  });

  test("valid_until more than 180 days in the future is rejected before sending", () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    assertThrows(
      () =>
        approveAgent(
          { transport, wallet, signatureChainId: "0x66eee" },
          { agentAddress: randomAddress(), agentName: `agent valid_until ${FROZEN + 180 * DAY_MS + 1}` },
        ),
      ValidationError,
      "at most 180 days in the future",
    );
    assertEquals(payloads.length, 0);
  });

  test("the guard also runs on the skipValidation path", () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    assertThrows(
      () =>
        approveAgent(
          { transport, wallet, signatureChainId: "0x66eee" },
          { agentAddress: randomAddress(), agentName: `agent valid_until ${FROZEN + 181 * DAY_MS}` },
          { skipValidation: true },
        ),
      ValidationError,
      "at most 180 days in the future",
    );
    assertEquals(payloads.length, 0);
  });

  test("a name without valid_until (no expiration) is not guarded", async () => {
    Date.now = () => FROZEN;
    const { transport, payloads } = recordingTransport();

    await approveAgent(
      { transport, wallet, signatureChainId: "0x66eee" },
      { agentAddress: randomAddress(), agentName: "myAgent" },
    );

    assertEquals(payloads.length, 1);
  });
});
