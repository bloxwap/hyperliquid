import { settledOutcome, type SettledOutcomeParameters, SettledOutcomeRequest } from "@bloxwap/hyperliquid/api/info";
import { runOfflineMethodTests } from "./_offlineMethodTests.ts";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/settledOutcome.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "SettledOutcomeResponse");
const paramsSchema = valibotToJsonSchema(v.omit(SettledOutcomeRequest, ["type"]));

runTest({
  name: "settledOutcome",
  codeTestFn: async (_t, client) => {
    const params: SettledOutcomeParameters[] = [{ outcome: 100 }, { outcome: 999999999 }];

    const data = await Promise.all(params.map((p) => client.settledOutcome(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data, [
      "#/anyOf/0/properties/spec/properties/sideSpecs/items/properties/token/present",
      // deployer/question are only present for template-deployed named outcomes (unobserved
      // live); the offline block below covers them.
      "#/anyOf/0/properties/spec/properties/deployer/present",
      "#/anyOf/0/properties/question/missing",
      "#/anyOf/0/properties/question/present",
      "#/anyOf/0/properties/question/properties/question/anyOf/0",
      "#/anyOf/0/properties/question/properties/question/anyOf/1",
    ]);
  },
});

// ============================================================
// Offline: response schema — deployer/question branches (issue #103)
// ============================================================

describe("settledOutcome (offline)", () => {
  test("spec.deployer and question variants satisfy the response schema", () => {
    // Covers: spec.deployer present/absent, question absent, question keyed by active and
    // by settled, sideSpecs token present/absent, and the null (not settled) branch.
    const base = {
      spec: {
        outcome: 1,
        name: "Yes",
        description: "Resolves yes",
        sideSpecs: [{ name: "Yes" }, { name: "No", token: 123 }],
        quoteToken: "USDC",
      },
      settleFraction: "1.0",
      details: "Settled in favor of Yes",
    };
    const samples = [
      base,
      {
        ...base,
        spec: { ...base.spec, deployer: "0x0000000000000000000000000000000000000001" },
        question: { question: { active: 5 }, name: "Will it rain?", description: "Rain market" },
      },
      {
        ...base,
        question: { question: { settled: 5 }, name: "Will it rain?", description: "Rain market" },
      },
      null,
    ];
    schemaCoverage(responseSchema, samples);
  });
});

// ============================================================
// Offline: request construction, passthrough, and InfoClient wrapper
// ============================================================

runOfflineMethodTests({
  name: "settledOutcome",
  method: settledOutcome,
  signature: "params",
  cases: [{ params: { outcome: 1 } }],
  invalidParams: [{ outcome: -1 }, { outcome: "abc" }, {}],
});
