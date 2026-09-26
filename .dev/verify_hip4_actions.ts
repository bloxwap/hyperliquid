/**
 * Checks which HIP-4 action formats testnet can deserialize, and reports local SDK compatibility.
 *
 * Every exchange request has r = s = 0, which cannot recover an ECDSA signer. No wallet or
 * credentials are loaded and no action can execute. Reaching signature recovery proves only
 * parsing support; staking, permissions, and successful deployment are outside this check.
 *
 * Usage: bun run .dev/verify_hip4_actions.ts
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions
 * @module
 */

import * as v from "valibot";
import { ActivateOutcomeDeployerRequest } from "../src/api/exchange/_methods/activateOutcomeDeployer.ts";
import { SpotDeployRequest } from "../src/api/exchange/_methods/spotDeploy.ts";

const API_URL = "https://api.hyperliquid-testnet.xyz";
const INVALID_SIGNATURE = { r: `0x${"0".repeat(64)}`, s: `0x${"0".repeat(64)}`, v: 27 };
const activationSchema = ActivateOutcomeDeployerRequest.entries.action;
const deploymentSchema = SpotDeployRequest.entries.action;

const instance = { id: "abc", keywordToValue: [["choice", "A"]], deployerFeeScale: "1" };
const settlement = {
  outcome: 7,
  settleFraction: "1",
  details: "",
  nameAndDescription: ["template:abc", "choice:A"],
  sideNames: ["Yes", "No"],
};
const deploy = (operation: Record<string, unknown>) => ({ type: "outcomeDeploy", venue: "ab", operation });

interface Probe {
  name: string;
  action: Record<string, unknown>;
  recognized: boolean;
  schema?: v.GenericSchema;
}

const probes: Probe[] = [
  { name: "control/noop", action: { type: "noop" }, recognized: true },
  { name: "control/unknown-action", action: { type: "invalidHip4ProbeAction" }, recognized: false },
  ...[false, true].map((isDeactivate) => ({
    name: `legacy/${isDeactivate ? "deactivate" : "activate"}`,
    action: { type: "activateOutcomeDeployer", isDeactivate },
    recognized: false,
    schema: activationSchema,
  })),
  {
    name: "documented/activate",
    action: { type: "activateOutcomeDeployer", activate: { venueName: "ab" } },
    recognized: true,
    schema: activationSchema,
  },
  {
    name: "documented/deactivate",
    action: { type: "activateOutcomeDeployer", deactivate: null },
    recognized: true,
    schema: activationSchema,
  },
  {
    name: "legacy/standalone",
    action: {
      type: "spotDeploy",
      outcome: { registerStandaloneOutcomeFromTemplate: { id: instance.id, keywordToValue: instance.keywordToValue } },
    },
    recognized: false,
    schema: deploymentSchema,
  },
  ...Object.entries({
    registerStandaloneOutcomeFromTemplate: instance,
    registerQuestionFromTemplate: {
      questionTemplateInstance: instance,
      namedOutcomeTemplateInstances: [{ id: "abc-outcome", keywordToValue: [["choice", "A"]] }],
    },
    registerAndAssociateNamedOutcomeFromTemplate: {
      question: 3,
      namedOutcomeTemplateInstance: { id: "abc-outcome", keywordToValue: [["choice", "C"]] },
    },
    settleOutcome: settlement,
    settleQuestion2: {
      question: 3,
      outcomeSettlements: [settlement],
      nameAndDescription: ["template:abc", "choice:A"],
    },
    setSubDeployers: [{ variant: "settleOutcome", user: "0x0000000000000000000000000000000000000001", allowed: true }],
  }).map(([operation, params]) => ({
    name: `documented/${operation}`,
    action: deploy({ [operation]: params }),
    recognized: true,
    schema: deploymentSchema,
  })),
  {
    name: "control/missing-venue",
    action: { type: "outcomeDeploy", operation: { registerStandaloneOutcomeFromTemplate: instance } },
    recognized: false,
  },
  {
    name: "control/missing-fee-scale",
    action: deploy({
      registerStandaloneOutcomeFromTemplate: { id: instance.id, keywordToValue: instance.keywordToValue },
    }),
    recognized: false,
  },
];

let failures = 0;
console.log(`HIP-4 parsing verification at ${new Date().toISOString()} (${API_URL})`);
for (const probe of probes) {
  const response = await fetch(`${API_URL}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: probe.action, nonce: Date.now(), signature: INVALID_SIGNATURE }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  const expectedBody = probe.recognized
    ? JSON.stringify({ status: "err", response: "Unable to recover signer." })
    : "Failed to deserialize the JSON body into the target type";
  const passed = response.status === (probe.recognized ? 200 : 422) && body === expectedBody;
  if (!passed) failures++;
  console.log(
    JSON.stringify({
      name: probe.name,
      passed,
      httpStatus: response.status,
      body,
      sdkSchemaAccepts: probe.schema ? v.safeParse(probe.schema, probe.action).success : undefined,
    }),
  );
}

// Read-only metadata summaries expose fields that may be missing from SDK response types.
for (const type of ["outcomeMeta", "outcomeTemplates"]) {
  const response = await fetch(`${API_URL}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${type}: HTTP ${response.status}`);
  const data = (await response.json()) as Record<string, unknown> | Record<string, unknown>[];
  const rows = Array.isArray(data) ? data : (data.outcomes as Record<string, unknown>[]);
  console.log(
    JSON.stringify({
      name: type,
      topLevelKeys: Array.isArray(data) ? undefined : Object.keys(data),
      count: rows.length,
      itemKeys: [...new Set(rows.flatMap((row) => Object.keys(row)))],
    }),
  );
}

console.log(`${probes.length - failures}/${probes.length} parsing checks matched; no actions executed.`);
if (failures > 0) process.exitCode = 1;
