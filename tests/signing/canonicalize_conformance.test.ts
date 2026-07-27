/**
 * Conformance guard for the assumption behind issue #8: that `v.parse` on an exchange request
 * schema already emits object keys in schema-entry order, making the `canonicalize` pass that
 * follows it in every exchange method a no-op.
 *
 * That assumption is **not** a valibot API guarantee — it falls out of `v.object`'s `~run`
 * building its result with `for (const key in this.entries)`. Key order decides the msgpack
 * bytes, which decide the L1 signature, so if a valibot upgrade or a schema edit ever broke it
 * the SDK would start signing payloads the exchange rejects. These tests are what makes that
 * break loud instead of silent, and they are the precondition anyone must re-check before
 * dropping the `canonicalize` calls from the ~58 exchange methods.
 *
 * Three things are pinned:
 * 1. `parse` output is already canonical for every exchange request schema exercised here.
 * 2. valibot still orders `v.object` output by entries, including nested/variant/piped objects.
 * 3. No exchange schema uses a construct where `canonicalize` and `v.parse` could disagree.
 *    (3) is the one that catches a *schema* edit rather than a *valibot* upgrade.
 *
 * A fourth block pins the issue #8 change itself: the already-canonical fast path in
 * `canonicalize` returns `parse` output by reference and never changes a byte versus the
 * pre-fast-path implementation, which is vendored below as the differential oracle.
 * @module
 */

import { describe, expect, test } from "bun:test";
import * as v from "valibot";

import * as exchange from "@bloxwap/hyperliquid/api/exchange";
import { canonicalize, CanonicalizeError } from "@bloxwap/hyperliquid/signing";
import { encode, type MsgpackValue } from "../../src/signing/_msgpack.ts";

// ============================================================
// Helpers
// ============================================================

/**
 * Renders a value as a string that encodes object key ORDER, not just key membership.
 *
 * `assertEquals` on two objects ignores key order, and key order is the whole point here, so
 * comparisons in this file go through this projection instead.
 */
function shape(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(shape).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .map((key) => `${key}:${shape(record[key])}`)
      .join(",")}}`;
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Asserts that canonicalizing `parse` output changes nothing — including key order. */
function assertAlreadyCanonical(label: string, schema: v.GenericSchema, input: unknown): void {
  const parsed = v.parse(schema, input);
  expect(shape(canonicalize(schema, parsed)), label).toBe(shape(parsed));
}

// ============================================================
// Test Data
// ============================================================

const ADDRESS = "0x1234567890123456789012345678901234567890";
const SIGNATURE = { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 };

/** One order, with the keys deliberately supplied out of schema order. */
const SCRAMBLED_ORDER = {
  t: { limit: { tif: "Gtc" } },
  r: false,
  s: "0.001",
  p: "30000",
  b: true,
  a: 0,
};

/**
 * Real exchange requests, one per interesting schema shape: plain object, array of objects,
 * nested union (`t`), variant-dispatched action, optional keys present and absent, and the
 * user-signed envelope. Inputs are written with keys out of schema order on purpose, so a
 * regression that stops reordering shows up here too.
 */
const REQUESTS: [name: string, schema: v.GenericSchema, input: unknown][] = [
  [
    "order (batch, nested union, optional grouping absent)",
    exchange.OrderRequest.entries.action as v.GenericSchema,
    { orders: [SCRAMBLED_ORDER, SCRAMBLED_ORDER], type: "order" },
  ],
  [
    "order (trigger arm of the `t` union, optional builder present)",
    exchange.OrderRequest.entries.action as v.GenericSchema,
    {
      grouping: "na",
      builder: { f: 10, b: ADDRESS },
      orders: [{ ...SCRAMBLED_ORDER, t: { trigger: { tpsl: "tp", triggerPx: "29000", isMarket: true } } }],
      type: "order",
    },
  ],
  [
    "cancel",
    exchange.CancelRequest.entries.action as v.GenericSchema,
    { cancels: [{ o: 12345, a: 0 }], type: "cancel" },
  ],
  [
    "cancelByCloid",
    exchange.CancelByCloidRequest.entries.action as v.GenericSchema,
    { cancels: [{ cloid: `0x${"a".repeat(32)}`, asset: 0 }], type: "cancelByCloid" },
  ],
  [
    "batchModify (oid union arm)",
    exchange.BatchModifyRequest.entries.action as v.GenericSchema,
    { modifies: [{ order: SCRAMBLED_ORDER, oid: 12345 }], type: "batchModify" },
  ],
  [
    "scheduleCancel (optional time present)",
    exchange.ScheduleCancelRequest.entries.action as v.GenericSchema,
    { time: 1700000000000, type: "scheduleCancel" },
  ],
  [
    "updateLeverage",
    exchange.UpdateLeverageRequest.entries.action as v.GenericSchema,
    { leverage: 5, isCross: true, asset: 0, type: "updateLeverage" },
  ],
  [
    "twapOrder",
    exchange.TwapOrderRequest.entries.action as v.GenericSchema,
    { twap: { t: false, r: false, m: 30, s: "1", b: true, a: 0 }, type: "twapOrder" },
  ],
  [
    "cSignerAction (variant whose options share the `type` literal)",
    exchange.CSignerActionRequest.entries.action as v.GenericSchema,
    { unjailSelf: null, type: "CSignerAction" },
  ],
  [
    "cValidatorAction (variant, nested object)",
    exchange.CValidatorActionRequest.entries.action as v.GenericSchema,
    {
      changeProfile: {
        commission_bps: null,
        signer: null,
        disable_delegations: null,
        description: "d",
        name: "n",
        unjailed: false,
        node_ip: { Ip: "1.2.3.4" },
      },
      type: "CValidatorAction",
    },
  ],
  [
    "perpDeploy (16-option variant that shares one `type` literal)",
    exchange.PerpDeployRequest.entries.action as v.GenericSchema,
    { setOracle: { externalPerpPxs: [], markPxs: [], oraclePxs: [], dex: "test" }, type: "perpDeploy" },
  ],
  [
    "usdSend (user-signed envelope)",
    exchange.UsdSendRequest.entries.action as v.GenericSchema,
    {
      time: 1700000000000,
      amount: "1",
      destination: ADDRESS,
      hyperliquidChain: "Mainnet",
      signatureChainId: "0x66eee",
      type: "usdSend",
    },
  ],
  [
    "approveAgent (optional agentName present)",
    exchange.ApproveAgentRequest.entries.action as v.GenericSchema,
    {
      agentName: "agent",
      nonce: 1700000000000,
      agentAddress: ADDRESS,
      hyperliquidChain: "Mainnet",
      signatureChainId: "0x66eee",
      type: "approveAgent",
    },
  ],
  [
    "sendAsset (optional fromSubAccount defaulted)",
    exchange.SendAssetRequest.entries.action as v.GenericSchema,
    {
      nonce: 1700000000000,
      amount: "1",
      token: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      destinationDex: "test",
      sourceDex: "",
      destination: ADDRESS,
      hyperliquidChain: "Mainnet",
      signatureChainId: "0x66eee",
      type: "sendAsset",
    },
  ],
  [
    "whole OrderRequest envelope (action + nonce + signature)",
    exchange.OrderRequest as v.GenericSchema,
    {
      signature: SIGNATURE,
      nonce: 1700000000000,
      action: { grouping: "na", orders: [SCRAMBLED_ORDER], type: "order" },
    },
  ],
];

// ============================================================
// Tests
// ============================================================

describe("canonicalize conformance", () => {
  describe("extra keys are rejected, including Object.prototype member names", () => {
    // A `key in entries` check would consult the prototype chain, so a data key named
    // `constructor`/`toString` would pass as "known" and be silently dropped from the signed
    // payload. `Object.hasOwn` keeps these loud.
    test.each(["constructor", "toString", "hasOwnProperty"])("extra key %s throws", (key) => {
      const schema = exchange.CancelRequest.entries.action as v.GenericSchema;
      const action = { type: "cancel", cancels: [{ a: 0, o: 12345 }], [key]: 1 };

      expect(() => canonicalize(schema, action)).toThrow(CanonicalizeError);
    });

    test("extra prototype-member key on a nested object throws", () => {
      const schema = exchange.CancelRequest.entries.action as v.GenericSchema;
      const action = { type: "cancel", cancels: [{ a: 0, o: 12345, constructor: 1 }] };

      expect(() => canonicalize(schema, action)).toThrow(CanonicalizeError);
    });

    test("extra prototype-member key defeats a union option match", () => {
      const schema = v.union([v.object({ a: v.string() }), v.object({ b: v.number() })]);
      // Neither option declares `constructor`; an `in`-based check would let option 1 match and
      // `reorderObject` would then silently drop the key. With no option matching, the union
      // passes the value through whole instead of mutilating it.
      const out = canonicalize(schema, { a: "x", constructor: 1 }) as Record<string, unknown>;
      expect(Object.hasOwn(out, "constructor")).toBe(true);
    });
  });

  describe("parse() output is already in schema key order", () => {
    for (const [name, schema, input] of REQUESTS) {
      test(name, () => {
        const parsed = v.parse(schema, input);

        // The premise: parse alone already yields canonical order...
        expect(shape(canonicalize(schema, parsed))).toBe(shape(parsed));

        // ...and it is genuinely reordering work, i.e. the input was NOT already canonical.
        // Without this the test would still pass if `canonicalize` became the identity.
        expect(shape(parsed)).not.toBe(shape(input));
      });
    }
  });

  describe("valibot still orders v.object output by entries", () => {
    test("root object", () => {
      assertAlreadyCanonical("root", v.object({ z: v.number(), a: v.string() }), { a: "x", z: 1 });
    });

    test("nested objects", () => {
      const schema = v.object({ outer: v.object({ y: v.number(), x: v.number() }), first: v.string() });
      assertAlreadyCanonical("nested", schema, { first: "s", outer: { x: 1, y: 2 } });
    });

    test("optional key present and absent", () => {
      const schema = v.object({ a: v.number(), b: v.optional(v.string()), c: v.number() });
      assertAlreadyCanonical("present", schema, { c: 3, b: "s", a: 1 });
      assertAlreadyCanonical("absent", schema, { c: 3, a: 1 });
    });

    test("optional key with a default is emitted in schema position, not appended", () => {
      const schema = v.object({ a: v.number(), b: v.optional(v.string(), "dflt"), c: v.number() });
      expect(Object.keys(v.parse(schema, { c: 3, a: 1 }))).toEqual(["a", "b", "c"]);
    });

    test("nullable and nullish wrappers", () => {
      const nullable = v.object({ a: v.number(), b: v.nullable(v.object({ q: v.number(), p: v.number() })) });
      assertAlreadyCanonical("nullable/null", nullable, { b: null, a: 1 });
      assertAlreadyCanonical("nullable/value", nullable, { b: { p: 1, q: 2 }, a: 1 });

      const nullish = v.object({ a: v.number(), b: v.nullish(v.string()), c: v.number() });
      assertAlreadyCanonical("nullish/absent", nullish, { c: 3, a: 1 });
      assertAlreadyCanonical("nullish/null", nullish, { c: 3, b: null, a: 1 });
    });

    test("objects inside arrays and tuples", () => {
      const arrays = v.object({ items: v.array(v.object({ b: v.number(), a: v.number() })) });
      assertAlreadyCanonical("array", arrays, {
        items: [
          { a: 1, b: 2 },
          { b: 4, a: 3 },
        ],
      });

      const tuples = v.object({ t: v.tuple([v.object({ b: v.number(), a: v.number() }), v.string()]) });
      assertAlreadyCanonical("tuple", tuples, { t: [{ a: 1, b: 2 }, "s"] });
    });

    test("variant-selected objects", () => {
      const schema = v.variant("kind", [
        v.object({ kind: v.literal("x"), zz: v.number(), aa: v.number() }),
        v.object({ kind: v.literal("y"), bb: v.number() }),
      ]);
      assertAlreadyCanonical("variant/x", schema, { aa: 1, zz: 2, kind: "x" });
      assertAlreadyCanonical("variant/y", schema, { bb: 1, kind: "y" });
    });

    test("union-selected objects with disjoint keys", () => {
      const schema = v.union([
        v.object({ limit: v.object({ tif: v.string() }) }),
        v.object({ trigger: v.object({ isMarket: v.boolean(), triggerPx: v.string(), tpsl: v.string() }) }),
      ]);
      assertAlreadyCanonical("union/limit", schema, { limit: { tif: "Gtc" } });
      assertAlreadyCanonical("union/trigger", schema, { trigger: { tpsl: "tp", triggerPx: "1", isMarket: false } });
    });

    test("objects behind v.pipe", () => {
      const piped = v.pipe(
        v.object({ z: v.number(), a: v.number() }),
        v.check((o) => o.z > 0),
      );
      assertAlreadyCanonical("pipe/root", piped, { a: 1, z: 2 });

      const nested = v.object({
        inner: v.pipe(
          v.object({ z: v.number(), a: v.number() }),
          v.check(() => true),
        ),
      });
      assertAlreadyCanonical("pipe/nested", nested, { inner: { a: 1, z: 2 } });
    });

    test("integer-like keys keep the engine's numeric-first order on both sides", () => {
      const schema = v.object({ b: v.number(), "2": v.number(), a: v.number(), "10": v.number() });
      assertAlreadyCanonical("integer-like", schema, { a: 1, "10": 2, b: 3, "2": 5 });
    });
  });

  // --- The cases where the assumption is FALSE ---------------
  // These are pinned deliberately: they are the constructs a schema edit must not introduce,
  // and the audit below is what enforces that. If valibot ever makes one of these agree with
  // `canonicalize`, this block fails and the audit can be relaxed accordingly.
  describe("known constructs where canonicalize and parse disagree", () => {
    test("exactOptional: an absent key reads as a missing required key", () => {
      const schema = v.object({ a: v.number(), b: v.exactOptional(v.string()) });
      const parsed = v.parse(schema, { a: 1 });
      expect(() => canonicalize(schema as v.GenericSchema, parsed)).toThrow(/Required key "b"/);
    });

    test("a union whose options share a key set can be resolved to a differently ordered option", () => {
      const schema = v.union([v.object({ a: v.string(), b: v.number() }), v.object({ b: v.number(), a: v.boolean() })]);
      const parsed = v.parse(schema, { a: true, b: 1 });
      expect(Object.keys(parsed)).toEqual(["b", "a"]); // valibot picked option 2
      expect(Object.keys(canonicalize(schema as v.GenericSchema, parsed))).toEqual(["a", "b"]); // canonicalize picked 1
    });

    test("a shape-changing transform above an object node is rejected", () => {
      const schema = v.pipe(
        v.object({ z: v.number(), a: v.number() }),
        v.transform((o) => ({ a: o.a, z: o.z, extra: 1 })),
      );
      const parsed = v.parse(schema, { a: 1, z: 2 });
      expect(() => canonicalize(schema as v.GenericSchema, parsed)).toThrow(/Key "extra"/);
    });

    test("looseObject is passed through: unknown keys are neither rejected nor ordered", () => {
      const schema = v.looseObject({ z: v.number(), a: v.number() });
      const parsed = v.parse(schema, { a: 1, extra: 3, z: 2 });
      // valibot appends the unknown key after the declared ones...
      expect(Object.keys(parsed)).toEqual(["z", "a", "extra"]);
      // ...and canonicalize has no "loose_object" branch, so it neither throws on `extra`
      // (as it would for a plain object) nor guarantees anything about ordering.
      expect(canonicalize(schema as v.GenericSchema, parsed)).toBe(parsed);
    });
  });

  // --- Schema audit ------------------------------------------
  // The tests above cover the inputs they enumerate; this one covers every schema, and is what
  // fires when a new action introduces a construct the enumerated cases do not reach.
  describe("no exchange schema uses a construct canonicalize can mis-handle", () => {
    interface Node {
      type?: string;
      kind?: string;
      entries?: Record<string, Node>;
      wrapped?: Node;
      item?: Node;
      items?: Node[];
      options?: Node[];
      key?: string;
      pipe?: Node[];
    }

    const OPTIONALISH = new Set(["optional", "nullable", "nullish", "exact_optional"]);
    const SCALARS = new Set([
      "string",
      "number",
      "boolean",
      "literal",
      "picklist",
      "enum",
      "null",
      "undefined",
      "bigint",
      "any",
      "unknown",
      "never",
      "date",
    ]);
    const WALKED = new Set(["object", "array", "tuple", "variant", "union", "optional", "nullable", "nullish"]);

    const keysOf = (node: Node): string[] => Object.keys(node.entries ?? {});
    const requiredOf = (node: Node): string[] => keysOf(node).filter((k) => !OPTIONALISH.has(node.entries![k].type!));
    /** True when a union/variant option can ever hold a record, i.e. can ever be reordered. */
    const recordish = (node: Node): boolean => node.type === "object";

    /**
     * Two object options are safe iff no single record can be structurally accepted by both,
     * or, if one can, they agree on the relative order of every key they share. `canonicalize`
     * takes the first structural match while valibot takes the first that validates, so only
     * that agreement makes the two choices interchangeable.
     */
    function optionsAgree(a: Node, b: Node): boolean {
      const ka = keysOf(a);
      const kb = keysOf(b);
      const shared = new Set(ka.filter((k) => kb.includes(k)));
      const bothRequired = new Set([...requiredOf(a), ...requiredOf(b)]);
      if (![...bothRequired].every((k) => shared.has(k))) return true; // no record can hit both
      const inA = ka.filter((k) => shared.has(k));
      const inB = kb.filter((k) => shared.has(k));
      return inA.join("|") === inB.join("|");
    }

    /** Collects every construct in `root` that `canonicalize` could mis-handle. */
    function auditNode(root: Node, rootPath: string): string[] {
      const problems: string[] = [];
      const visited = new Set<Node>();

      const audit = (node: Node, path: string): void => {
        if (!node || typeof node !== "object" || visited.has(node)) return;
        visited.add(node);
        const t = node.type ?? "?";

        for (const step of node.pipe ?? []) {
          if (step.kind === "transformation" && recordish(node)) {
            problems.push(`${path}: transformation "${step.type}" sits on an object node`);
          }
        }

        if (t === "object" || t === "loose_object" || t === "object_with_rest") {
          if (t !== "object") problems.push(`${path}: "${t}" is not reordered by canonicalize`);
          for (const [key, child] of Object.entries(node.entries ?? {})) {
            if (child.type === "exact_optional") problems.push(`${path}.${key}: exact_optional`);
            audit(child, `${path}.${key}`);
          }
          return;
        }

        switch (t) {
          case "optional":
          case "nullable":
          case "nullish":
          case "exact_optional":
            if (node.wrapped) audit(node.wrapped, path);
            return;
          case "array":
            if (node.item) audit(node.item, `${path}[]`);
            return;
          case "tuple": {
            const items = node.items ?? [];
            for (let i = 0; i < items.length; i++) audit(items[i], `${path}[${i}]`);
            return;
          }
          case "variant":
          case "union": {
            const options = node.options ?? [];
            const objects = options.map((option, i) => ({ option, i })).filter(({ option }) => recordish(option));
            for (let x = 0; x < objects.length; x++) {
              for (let y = x + 1; y < objects.length; y++) {
                if (!optionsAgree(objects[x].option, objects[y].option)) {
                  problems.push(`${path}: ${t} options #${objects[x].i}/#${objects[y].i} can both match, out of order`);
                }
              }
            }
            for (let i = 0; i < options.length; i++) audit(options[i], `${path}|${t}#${i}`);
            return;
          }
          default:
            if (!SCALARS.has(t) && !WALKED.has(t)) problems.push(`${path}: node type "${t}" is not walked`);
            return;
        }
      };

      audit(root, rootPath);
      return problems;
    }

    test("every *Request action schema audits clean", () => {
      const problems: string[] = [];
      let audited = 0;
      for (const [name, schema] of Object.entries(exchange)) {
        if (!name.endsWith("Request")) continue;
        const node = schema as unknown as Node;
        if (typeof node !== "object" || node === null || node.type !== "object" || !node.entries?.action) continue;
        audited++;
        problems.push(...auditNode(node.entries.action, name));
      }

      // A drop here would mean the audit silently stopped covering the API.
      expect(audited).toBeGreaterThanOrEqual(50);
      expect(problems).toEqual([]);
    });

    // The audit is only worth anything if it actually fires. Each of these mirrors one of the
    // "known constructs where canonicalize and parse disagree" cases above.
    test.each([
      ["exact_optional entry", v.object({ a: v.number(), b: v.exactOptional(v.string()) })],
      ["loose_object", v.looseObject({ a: v.number() })],
      [
        "shape-changing transform on an object",
        v.pipe(
          v.object({ z: v.number(), a: v.number() }),
          v.transform((o) => ({ ...o, extra: 1 })),
        ),
      ],
      [
        "union options sharing a key set in conflicting order",
        v.union([v.object({ a: v.string(), b: v.number() }), v.object({ b: v.number(), a: v.boolean() })]),
      ],
      ["record", v.record(v.string(), v.number())],
      ["intersect", v.intersect([v.object({ z: v.number() }), v.object({ a: v.number() })])],
    ])("the audit rejects %s", (_label, schema) => {
      expect(auditNode(schema as unknown as Node, "synthetic").length).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// Issue #8: the already-canonical fast path
// ============================================================

// --- Oracle: the pre-fast-path implementation ----------------
// Verbatim copy of `walk`/`reorderObject` and their helpers from `src/signing/_canonicalize.ts`
// as they were before the fast path landed (only the output-neutral key-list memoization is
// elided). This is the "old path" the differential tests compare against — the same role
// `@std/msgpack` and viem play as oracles elsewhere in this directory.

interface OracleNode {
  readonly type: string;
  readonly entries?: Record<string, OracleNode>;
  readonly wrapped?: OracleNode;
  readonly item?: OracleNode;
  readonly items?: readonly OracleNode[];
  readonly key?: string;
  readonly options?: readonly OracleNode[];
  readonly literal?: unknown;
}

function oracleWalk(schema: OracleNode, value: unknown): unknown {
  const t = schema.type;

  if (t === "optional" || t === "nullable" || t === "nullish") {
    return value === null || value === undefined ? value : oracleWalk(schema.wrapped!, value);
  }

  if (t === "object" && isRecord(value)) {
    return oracleReorderObject(schema.entries!, value);
  }

  if (t === "array" && Array.isArray(value)) {
    return value.map((item) => oracleWalk(schema.item!, item));
  }

  if (t === "tuple" && Array.isArray(value)) {
    return value.map((item, i) => oracleWalk(schema.items![i], item));
  }

  if (t === "variant" && isRecord(value)) {
    const option = oracleMatchVariantOption(schema.key!, schema.options!, value);
    if (option) return oracleWalk(option, value);
    throw new CanonicalizeError(
      `No variant option matches data (discriminator "${schema.key}" = ${JSON.stringify(value[schema.key!])})`,
    );
  }

  if (t === "union" && isRecord(value)) {
    const option = oracleMatchByStructure(schema.options!, value);
    if (option) return oracleWalk(option, value);
    return value;
  }

  return value;
}

function oracleReorderObject(
  entries: Record<string, OracleNode>,
  value: Record<string, unknown>,
): Record<string, unknown> {
  for (const key in value) {
    if (!Object.hasOwn(entries, key)) {
      throw new CanonicalizeError(`Key "${key}" exists in data but not in schema`);
    }
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(entries)) {
    if (key in value) {
      result[key] = oracleWalk(entries[key], value[key]);
    } else {
      const t = entries[key].type;
      if (t !== "optional" && t !== "nullable" && t !== "nullish") {
        throw new CanonicalizeError(`Required key "${key}" exists in schema but not in data`);
      }
    }
  }
  return result;
}

function oracleMatchVariantOption(
  discriminatorKey: string,
  options: readonly OracleNode[],
  value: Record<string, unknown>,
): OracleNode | undefined {
  const discriminatorValue = value[discriminatorKey];

  let firstMatch: OracleNode | undefined;
  let extraMatches: OracleNode[] | undefined;
  for (const option of options) {
    if (option.type === "object" && option.entries && discriminatorKey in option.entries) {
      const keySchema = option.entries[discriminatorKey];
      if (keySchema.type === "literal" && keySchema.literal === discriminatorValue) {
        if (firstMatch === undefined) {
          firstMatch = option;
        } else {
          (extraMatches ??= [firstMatch]).push(option);
        }
      }
    }
  }

  if (extraMatches === undefined) return firstMatch;
  return oracleMatchByStructure(extraMatches, value);
}

function oracleMatchByStructure(
  options: readonly OracleNode[],
  value: Record<string, unknown>,
): OracleNode | undefined {
  for (const option of options) {
    if (option.type !== "object" || !option.entries) continue;

    let allKnown = true;
    for (const key in value) {
      if (!Object.hasOwn(option.entries, key)) {
        allKnown = false;
        break;
      }
    }
    if (!allKnown) continue;

    let allRequired = true;
    for (const key of Object.keys(option.entries)) {
      if (key in value) continue;
      const t = option.entries[key].type;
      if (t !== "optional" && t !== "nullable" && t !== "nullish") {
        allRequired = false;
        break;
      }
    }
    if (allRequired) return option;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("canonicalize() fast path (issue #8)", () => {
  describe("returns parse() output by reference — the rebuild is skipped entirely", () => {
    for (const [name, schema, input] of REQUESTS) {
      test(name, () => {
        const parsed = v.parse(schema, input);

        // Reference identity, not just equal shape: no object was rebuilt anywhere on the walk.
        expect(canonicalize(schema, parsed)).toBe(parsed);
      });
    }

    test("canonical subtrees are shared, not copied", () => {
      const schema = exchange.OrderRequest.entries.action as v.GenericSchema;
      const parsed = v.parse(schema, { orders: [SCRAMBLED_ORDER], type: "order" }) as {
        orders: { t: unknown }[];
      };

      const out = canonicalize(schema, parsed);

      expect(out).toBe(parsed);
      expect(out.orders).toBe(parsed.orders);
      expect(out.orders[0]).toBe(parsed.orders[0]);
      expect(out.orders[0].t).toBe(parsed.orders[0].t);
    });
  });

  describe("byte-identical to the pre-fast-path implementation", () => {
    // The parsed (canonical) form exercises the fast path; the same request with scrambled
    // keys exercises the rebuild path. Both must produce the old implementation's bytes.
    for (const [name, schema, input] of REQUESTS) {
      test(`fast path: ${name}`, () => {
        const parsed = v.parse(schema, input);
        expect(encode(canonicalize(schema, parsed) as MsgpackValue)).toEqual(
          encode(oracleWalk(schema as unknown as OracleNode, parsed) as MsgpackValue),
        );
      });

      test(`rebuild path: ${name}`, () => {
        expect(encode(canonicalize(schema, input) as MsgpackValue)).toEqual(
          encode(oracleWalk(schema as unknown as OracleNode, input) as MsgpackValue),
        );
      });
    }

    test("an inherited enumerable key that IS declared is still promoted to an own key", () => {
      // The rebuild copies the inherited `b` onto the result as an own key. If the fast path
      // returned the input as-is here, the encoder (`Object.keys` — own keys only) would see
      // one key fewer than the old implementation produced.
      const schema = v.object({ a: v.number(), b: v.number() });
      const input = Object.assign(Object.create({ b: 2 }), { a: 1 });

      const out = canonicalize(schema as v.GenericSchema, input) as Record<string, unknown>;
      const oracle = oracleWalk(schema as unknown as OracleNode, input) as Record<string, unknown>;

      expect(Object.keys(out)).toEqual(["a", "b"]);
      expect(encode(out as MsgpackValue)).toEqual(encode(oracle as MsgpackValue));
    });

    test("integer-like keys keep the engine's numeric-first order on both paths", () => {
      const schema = v.object({ b: v.number(), "2": v.number(), a: v.number(), "10": v.number() });
      const parsed = v.parse(schema, { a: 1, "10": 2, b: 3, "2": 5 });

      expect(canonicalize(schema as v.GenericSchema, parsed)).toBe(parsed);
      expect(encode(canonicalize(schema as v.GenericSchema, parsed) as MsgpackValue)).toEqual(
        encode(oracleWalk(schema as unknown as OracleNode, parsed) as MsgpackValue),
      );
    });
  });

  describe("throws identically to the pre-fast-path implementation", () => {
    const ERROR_CASES: [name: string, schema: v.GenericSchema, input: unknown][] = [
      ["extra key at the root", v.object({ a: v.number() }), { a: 1, z: 2 }],
      ["extra key nested", v.object({ a: v.object({ b: v.number() }) }), { a: { b: 1, z: 2 } }],
      ["missing required key", v.object({ a: v.number(), b: v.number() }), { a: 1 }],
      [
        "unmatched variant discriminator",
        v.variant("k", [v.object({ k: v.literal("x"), a: v.number() })]),
        { k: "y", a: 1 },
      ],
    ];

    for (const [name, schema, input] of ERROR_CASES) {
      test(name, () => {
        let newError: Error | undefined;
        let oracleError: Error | undefined;
        try {
          canonicalize(schema, input);
        } catch (error) {
          newError = error as Error;
        }
        try {
          oracleWalk(schema as unknown as OracleNode, input);
        } catch (error) {
          oracleError = error as Error;
        }

        expect(newError).toBeInstanceOf(CanonicalizeError);
        expect(newError?.message).toBe(oracleError?.message);
      });
    }

    test("over-long tuple dies the same way (TypeError from the missing item schema)", () => {
      const schema = v.tuple([v.number()]) as unknown as v.GenericSchema;

      expect(() => canonicalize(schema, [1, 2])).toThrow(TypeError);
      expect(() => oracleWalk(schema as unknown as OracleNode, [1, 2])).toThrow(TypeError);
    });
  });
});

describe("canonicalize() fast-path variant and union checks", () => {
  test("a canonical variant child passes by reference", () => {
    const schema = v.object({
      t: v.variant("type", [
        v.object({ type: v.literal("a"), x: v.number() }),
        v.object({ type: v.literal("b"), y: v.number() }),
      ]),
    });
    const value = { t: { type: "a" as const, x: 1 } };

    // Already canonical: the identity check must descend into the variant child and match its option.
    expect(canonicalize(schema, value)).toBe(value);
  });

  test("a non-canonical variant child is rebuilt in schema order", () => {
    const schema = v.object({
      t: v.variant("type", [
        v.object({ type: v.literal("a"), x: v.number() }),
        v.object({ type: v.literal("b"), y: v.number() }),
      ]),
    });
    const value = { t: { x: 1, type: "a" as const } };

    const out = canonicalize(schema, value);
    expect(out).not.toBe(value);
    expect(Object.keys(out.t)).toEqual(["type", "x"]);
    expect(out).toEqual(value);
  });

  test("an unmatched variant child takes the slow path and throws CanonicalizeError", () => {
    const schema = v.object({
      t: v.variant("type", [v.object({ type: v.literal("a"), x: v.number() })]),
    });

    expect(() => canonicalize(schema, { t: { type: "z" } })).toThrow(CanonicalizeError);
  });

  test("union matching skips an option that is missing a required key", () => {
    const options = [v.object({ a: v.string(), b: v.string() }), v.object({ a: v.string() })];
    // Top-level union: `walk` consults the structural matcher directly.
    expect(canonicalize(v.union(options), { a: "1" })).toEqual({ a: "1" });
    // Union as a child: the identity check consults it too, and the value passes by reference.
    const schema = v.object({ u: v.union(options) });
    const value = { u: { a: "1" } };
    expect(canonicalize(schema, value)).toBe(value);
  });

  test("union matching accepts an option whose only missing key is optional", () => {
    const options = [v.object({ a: v.string(), b: v.optional(v.string()) }), v.object({ a: v.string() })];
    // The first option matches despite `b` being absent: an optional key is not required.
    const value = { a: "1" };
    expect(canonicalize(v.union(options), value)).toBe(value);
  });
});
