import { ApiRequestError, ValidationError } from "@bloxwap/hyperliquid";
import { type SpotDeployParameters, SpotDeployRequest, spotDeploy } from "@bloxwap/hyperliquid/api/exchange";
import { createL1ActionHash } from "@bloxwap/hyperliquid/signing";
import * as v from "valibot";
import { describe, expect, test } from "bun:test";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import { encode } from "@jsr/std__msgpack";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";
import { FIXED_NONCE, recordingTransport, singleWalletConfig } from "./_mockTransport.ts";

const paramsSchema = valibotToJsonSchema(
  v.union(SpotDeployRequest.entries.action.options.map((option) => v.omit(option, ["type"]))),
);

runTest({
  name: "spotDeploy",
  codeTestFn: async (_t, exchClient) => {
    const params: SpotDeployParameters[] = [
      {
        registerToken2: {
          spec: {
            name: "TestToken",
            szDecimals: 8,
            weiDecimals: 8,
          },
          maxGas: 1000000,
          fullName: "TestToken (TT)",
        },
      },
      {
        registerToken2: {
          spec: {
            name: "TestToken2",
            szDecimals: 8,
            weiDecimals: 8,
          },
          maxGas: 1000000,
        },
      },
      {
        userGenesis: {
          token: 0,
          userAndWei: [["0x0000000000000000000000000000000000000001", "1"]],
          existingTokenAndWei: [[0, "1"]],
          blacklistUsers: [["0x0000000000000000000000000000000000000001", true]],
        },
      },
      {
        userGenesis: {
          token: 0,
          userAndWei: [],
          existingTokenAndWei: [],
        },
      },
      {
        genesis: {
          token: 0,
          maxSupply: "10000000000",
          noHyperliquidity: true,
        },
      },
      {
        genesis: {
          token: 0,
          maxSupply: "10000000000",
        },
      },
      {
        registerSpot: {
          tokens: [0, 0],
        },
      },
      {
        registerHyperliquidity: {
          spot: 0,
          startPx: "1",
          orderSz: "1",
          nOrders: 1,
          nSeededLevels: 1,
        },
      },
      {
        registerHyperliquidity: {
          spot: 0,
          startPx: "1",
          orderSz: "1",
          nOrders: 1,
        },
      },
      {
        setDeployerTradingFeeShare: {
          token: 0,
          share: "0%",
        },
      },
      {
        enableQuoteToken: {
          token: 0,
        },
      },
      {
        disableQuoteToken: {
          token: 0,
        },
      },
      {
        enableAlignedQuoteToken: {
          token: 0,
        },
      },
      {
        disableAlignedQuoteToken: {
          token: 0,
        },
      },
      {
        setTokenAnnotation: {
          token: 0,
          annotation: {
            category: "defi",
            description: "Test token annotation",
            displayName: null,
            keywords: ["test"],
          },
        },
      },
      {
        setTokenAnnotation: {
          token: 0,
          annotation: {
            category: "defi",
            description: "Test token annotation",
            displayName: "TT",
            keywords: ["test", "token"],
          },
        },
      },
      {
        setDeployerLabel: {
          label: "tt",
        },
      },
      {
        requestEvmContract: {
          token: 0,
          address: "0x0000000000000000000000000000000000000001",
          evmExtraWeiDecimals: 0,
        },
      },
      {
        outcome: {
          registerStandaloneOutcomeFromTemplate: {
            id: "binaryPrice",
            keywordToValue: [
              ["perp", "BTC"],
              ["threshold", "1000000"],
              ["time", "20260901-0600"],
            ],
          },
        },
      },
      {
        outcome: {
          registerQuestionFromTemplate: {
            questionTemplateInstance: {
              id: "binaryPrice",
              keywordToValue: [
                ["perp", "BTC"],
                ["threshold", "1000000"],
                ["time", "20260901-0600"],
              ],
            },
            namedOutcomeTemplateInstances: [
              {
                id: "binaryPrice",
                keywordToValue: [
                  ["perp", "BTC"],
                  ["threshold", "1000000"],
                  ["time", "20260901-0600"],
                ],
              },
            ],
          },
        },
      },
      {
        outcome: {
          settleOutcome: {
            outcome: 0,
            settleFraction: "1",
            details: "",
            nameAndDescription: ["template:binaryPrice", "perp:BTC"],
            sideNames: ["Yes", "No"],
          },
        },
      },
      {
        outcome: {
          settleQuestion2: {
            question: 0,
            outcomeSettlements: [
              {
                outcome: 0,
                settleFraction: "1",
                details: "",
                nameAndDescription: ["template:binaryPrice", "perp:BTC"],
                sideNames: ["Yes", "No"],
              },
            ],
            nameAndDescription: ["template:binaryPrice", "perp:BTC"],
          },
        },
      },
    ];

    await Promise.all(
      params.map((p) =>
        assertRejects(async () => {
          await exchClient.spotDeploy(p);
        }, ApiRequestError),
      ),
    );

    schemaCoverage(paramsSchema, params);
  },
});

// ============================================================
// Offline: aligned quote token action variants
// ============================================================

describe("spotDeploy (offline)", () => {
  test("setTokenAnnotation and setDeployerLabel are accepted and posted", async () => {
    const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const payloads: { action: Record<string, unknown> }[] = [];
    const transport: IRequestTransport = {
      isTestnet: true,
      request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        payloads.push(payload as { action: Record<string, unknown> });
        return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
      },
    };

    const annotationNull = {
      category: "defi",
      description: "Test token annotation",
      displayName: null,
      keywords: ["test"],
    };
    const annotationNamed = {
      category: "defi",
      description: "Test token annotation",
      displayName: "TT",
      keywords: ["test", "token"],
    };

    await spotDeploy({ transport, wallet }, { setTokenAnnotation: { token: 1, annotation: annotationNull } });
    await spotDeploy({ transport, wallet }, { setTokenAnnotation: { token: 1, annotation: annotationNamed } });
    await spotDeploy({ transport, wallet }, { setDeployerLabel: { label: "tt" } });

    assertEquals(
      payloads.map((p) => p.action),
      [
        { type: "spotDeploy", setTokenAnnotation: { token: 1, annotation: annotationNull } },
        { type: "spotDeploy", setTokenAnnotation: { token: 1, annotation: annotationNamed } },
        { type: "spotDeploy", setDeployerLabel: { label: "tt" } },
      ],
    );

    // Key order decides the msgpack bytes that get signed, so pin the documented order explicitly.
    const postedAnnotation = payloads[0].action.setTokenAnnotation as { annotation: Record<string, unknown> };
    assertEquals(Object.keys(postedAnnotation.annotation), ["category", "description", "displayName", "keywords"]);
    assertEquals(Object.keys(postedAnnotation), ["token", "annotation"]);
    const postedLabel = payloads[2].action.setDeployerLabel as Record<string, unknown>;
    assertEquals(Object.keys(postedLabel), ["label"]);
  });

  test("setTokenAnnotation and setDeployerLabel preserve msgpack/hash parity", async () => {
    const annotation = {
      category: "defi",
      description: "Test token annotation",
      displayName: null,
      keywords: ["test"],
    };
    const cases: SpotDeployParameters[] = [
      { setTokenAnnotation: { token: 1, annotation } },
      { setDeployerLabel: { label: "tt" } },
    ];
    for (const params of cases) {
      const { transport, calls } = recordingTransport();
      await spotDeploy(singleWalletConfig(transport), params);
      const expected = { type: "spotDeploy", ...params };
      expect(calls[0].payload.action).toEqual(expected);
      const encoded = encode(expected as Parameters<typeof encode>[0]);
      const wire = new Uint8Array(encoded.length + 9);
      wire.set(encoded);
      new DataView(wire.buffer).setBigUint64(encoded.length, BigInt(FIXED_NONCE));
      const reference = `0x${Buffer.from(keccak_256(wire)).toString("hex")}` as const;
      expect(createL1ActionHash({ action: calls[0].payload.action, nonce: FIXED_NONCE })).toBe(reference);
    }
  });

  test("invalid annotations and labels are rejected before the transport is called", async () => {
    const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const payloads: unknown[] = [];
    const transport: IRequestTransport = {
      isTestnet: true,
      request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        payloads.push(payload);
        return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
      },
    };

    const baseAnnotation = {
      category: "defi",
      description: "Test token annotation",
      displayName: null as string | null,
      keywords: ["test"],
    };
    const invalidParams: SpotDeployParameters[] = [
      { setTokenAnnotation: { token: 1, annotation: { ...baseAnnotation, category: "a".repeat(16) } } },
      { setTokenAnnotation: { token: 1, annotation: { ...baseAnnotation, description: "a".repeat(401) } } },
      { setTokenAnnotation: { token: 1, annotation: { ...baseAnnotation, displayName: "a".repeat(10) } } },
      { setTokenAnnotation: { token: 1, annotation: { ...baseAnnotation, keywords: ["a", "b", "c"] } } },
      { setTokenAnnotation: { token: 1, annotation: { ...baseAnnotation, keywords: ["a".repeat(11)] } } },
      { setDeployerLabel: { label: "A" } },
      { setDeployerLabel: { label: "toolong" } },
      { setDeployerLabel: { label: "Ab" } },
    ];

    for (const params of invalidParams) {
      await assertRejects(async () => {
        await spotDeploy({ transport, wallet }, params);
      }, ValidationError);
    }
    assertEquals(payloads.length, 0);
  });

  test("enableAlignedQuoteToken and disableAlignedQuoteToken are accepted and posted", async () => {
    const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const payloads: { action: Record<string, unknown> }[] = [];
    const transport: IRequestTransport = {
      isTestnet: true,
      request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        payloads.push(payload as { action: Record<string, unknown> });
        return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
      },
    };

    await spotDeploy({ transport, wallet }, { enableAlignedQuoteToken: { token: 1 } });
    await spotDeploy({ transport, wallet }, { disableAlignedQuoteToken: { token: 1 } });

    assertEquals(
      payloads.map((p) => p.action),
      [
        { type: "spotDeploy", enableAlignedQuoteToken: { token: 1 } },
        { type: "spotDeploy", disableAlignedQuoteToken: { token: 1 } },
      ],
    );
  });

  test("outcome sub-actions are accepted and posted", async () => {
    const wallet = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const payloads: { action: Record<string, unknown> }[] = [];
    const transport: IRequestTransport = {
      isTestnet: true,
      request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        payloads.push(payload as { action: Record<string, unknown> });
        return Promise.resolve({ status: "ok", response: { type: "default" } } as T);
      },
    };

    const templateInstance: { id: string; keywordToValue: [string, string][] } = {
      id: "binaryPrice",
      keywordToValue: [
        ["perp", "BTC"],
        ["threshold", "1000000"],
        ["time", "20260901-0600"],
      ],
    };

    await spotDeploy(
      { transport, wallet },
      {
        outcome: { registerStandaloneOutcomeFromTemplate: templateInstance },
      },
    );
    await spotDeploy(
      { transport, wallet },
      {
        outcome: {
          registerQuestionFromTemplate: {
            questionTemplateInstance: templateInstance,
            namedOutcomeTemplateInstances: [templateInstance],
          },
        },
      },
    );
    await spotDeploy(
      { transport, wallet },
      {
        outcome: {
          settleOutcome: {
            outcome: 0,
            settleFraction: "1",
            details: "",
            nameAndDescription: ["template:binaryPrice", "perp:BTC"],
            sideNames: ["Yes", "No"],
          },
        },
      },
    );
    await spotDeploy(
      { transport, wallet },
      {
        outcome: {
          settleQuestion2: {
            question: 0,
            outcomeSettlements: [
              {
                outcome: 0,
                settleFraction: "1",
                details: "",
                nameAndDescription: ["template:binaryPrice", "perp:BTC"],
                sideNames: ["Yes", "No"],
              },
            ],
            nameAndDescription: ["template:binaryPrice", "perp:BTC"],
          },
        },
      },
    );

    assertEquals(
      payloads.map((p) => p.action),
      [
        { type: "spotDeploy", outcome: { registerStandaloneOutcomeFromTemplate: templateInstance } },
        {
          type: "spotDeploy",
          outcome: {
            registerQuestionFromTemplate: {
              questionTemplateInstance: templateInstance,
              namedOutcomeTemplateInstances: [templateInstance],
            },
          },
        },
        {
          type: "spotDeploy",
          outcome: {
            settleOutcome: {
              outcome: 0,
              settleFraction: "1",
              details: "",
              nameAndDescription: ["template:binaryPrice", "perp:BTC"],
              sideNames: ["Yes", "No"],
            },
          },
        },
        {
          type: "spotDeploy",
          outcome: {
            settleQuestion2: {
              question: 0,
              outcomeSettlements: [
                {
                  outcome: 0,
                  settleFraction: "1",
                  details: "",
                  nameAndDescription: ["template:binaryPrice", "perp:BTC"],
                  sideNames: ["Yes", "No"],
                },
              ],
              nameAndDescription: ["template:binaryPrice", "perp:BTC"],
            },
          },
        },
      ],
    );
  });
});
