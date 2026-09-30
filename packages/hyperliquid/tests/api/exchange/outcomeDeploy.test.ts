import { assertRejects } from "@jsr/std__assert";
import { describe, expect, test } from "bun:test";
import { ExchangeClient } from "@bloxwap/hyperliquid";
import { outcomeDeploy, type OutcomeDeployParameters } from "@bloxwap/hyperliquid/api/exchange";
import { createL1ActionHash } from "@bloxwap/hyperliquid/signing";
import { encode } from "@jsr/std__msgpack";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { recordingTransport, singleWalletConfig, FIXED_NONCE } from "./_mockTransport.ts";

const template = { id: "abc", keywordToValue: [["expiry", "20261001-0600"]] as [string, string][] };
const settlement = {
  outcome: 1,
  settleFraction: "1",
  details: "",
  nameAndDescription: ["template:abc", "expiry:20261001-0600"] as [string, string],
  sideNames: ["Yes", "No"] as [string, string],
};
const operations: OutcomeDeployParameters["operation"][] = [
  { registerStandaloneOutcomeFromTemplate: { ...template, deployerFeeScale: "1" } },
  {
    registerQuestionFromTemplate: {
      questionTemplateInstance: { ...template, deployerFeeScale: "0.5" },
      namedOutcomeTemplateInstances: [template],
    },
  },
  { registerAndAssociateNamedOutcomeFromTemplate: { question: 1, namedOutcomeTemplateInstance: template } },
  { settleOutcome: settlement },
  {
    settleQuestion2: {
      question: 1,
      outcomeSettlements: [settlement],
      nameAndDescription: ["template:abc", "expiry:20261001-0600"],
    },
  },
  {
    setSubDeployers: [{ variant: "settleQuestion", user: "0x1234567890123456789012345678901234567890", allowed: true }],
  },
];

describe("outcomeDeploy", () => {
  test("all six operations preserve the venue and operation, with independent msgpack/hash parity", async () => {
    for (const operation of operations) {
      const { transport, calls } = recordingTransport();
      const config = singleWalletConfig(transport);
      await outcomeDeploy(config, { operation, venue: "ab" });
      await new ExchangeClient(config).outcomeDeploy({ venue: "ab", operation });
      const expected = { type: "outcomeDeploy", venue: "ab", operation };
      expect(calls[0].payload.action).toEqual(expected);
      expect(calls[1].payload).toEqual(calls[0].payload);
      expect(Object.keys(calls[0].payload.action)).toEqual(["type", "venue", "operation"]);
      const encoded = encode(expected as Parameters<typeof encode>[0]);
      const wire = new Uint8Array(encoded.length + 9);
      wire.set(encoded);
      new DataView(wire.buffer).setBigUint64(encoded.length, BigInt(FIXED_NONCE));
      const reference = `0x${Buffer.from(keccak_256(wire)).toString("hex")}` as const;
      expect(createL1ActionHash({ action: calls[0].payload.action, nonce: FIXED_NONCE })).toBe(reference);
    }
  });
  test("rejects missing venue, missing fee scale and out-of-range fee scales before signing", async () => {
    for (const params of [
      { operation: operations[0] },
      { venue: "ab", operation: { registerStandaloneOutcomeFromTemplate: template } },
      ...["-1", "10.01"].map((deployerFeeScale) => ({
        venue: "ab",
        operation: { registerStandaloneOutcomeFromTemplate: { ...template, deployerFeeScale } },
      })),
    ]) {
      const { transport, calls } = recordingTransport();
      await assertRejects(async () => outcomeDeploy(singleWalletConfig(transport), params as never));
      expect(calls).toHaveLength(0);
    }
  });
});
