/**
 * Offline tests for convertToMultiSigUser: the `authorizedUsers` list is sorted (after
 * lowercasing) before signing and posting, so signatures match the Python SDK regardless
 * of the input order.
 * @module
 */

import { describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { convertToMultiSigUser } from "@bloxwap/hyperliquid/api/exchange";
import { privateKeyToAccount } from "viem/accounts";

const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

const USER_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const USER_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const USER_C = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

/** Creates a transport stub that records posted payloads and resolves with a success response. */
function recordingTransport(): { transport: IRequestTransport; payloads: { action: { signers: string } }[] } {
  const payloads: { action: { signers: string } }[] = [];
  const transport: IRequestTransport = {
    isTestnet: true,
    request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
      payloads.push(payload as { action: { signers: string } });
      return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
    },
  };
  return { transport, payloads };
}

describe("convertToMultiSigUser (offline)", () => {
  test("unsorted object input is posted sorted and lowercased", async () => {
    const { transport, payloads } = recordingTransport();

    await convertToMultiSigUser(
      { transport, wallet, signatureChainId: "0x66eee" },
      { signers: { authorizedUsers: [USER_B, USER_C, USER_A], threshold: 2 } },
    );

    assertEquals(JSON.parse(payloads[0].action.signers), {
      authorizedUsers: [USER_A, USER_B, USER_C.toLowerCase()],
      threshold: 2,
    });
  });

  test("unsorted JSON string input is posted sorted", async () => {
    const { transport, payloads } = recordingTransport();

    await convertToMultiSigUser(
      { transport, wallet, signatureChainId: "0x66eee" },
      { signers: JSON.stringify({ authorizedUsers: [USER_B, USER_A], threshold: 1 }) },
    );

    assertEquals(JSON.parse(payloads[0].action.signers), {
      authorizedUsers: [USER_A, USER_B],
      threshold: 1,
    });
  });

  test("null signers (revert to single-sig) pass through unchanged", async () => {
    const { transport, payloads } = recordingTransport();

    await convertToMultiSigUser({ transport, wallet, signatureChainId: "0x66eee" }, { signers: null });

    assertEquals(payloads[0].action.signers, "null");
  });
});
