/**
 * Equivalence tests for the short-circuited `string | number` union in `src/api/_schemas.ts`.
 *
 * `UnsignedDecimal`, `Decimal`, `Integer` and `UnsignedInteger` start with a union whose accepting path
 * skips valibot's option loop. That is only an optimization if it is unobservable, so each schema is
 * compared against a reference built from its own pipe with the first step swapped back to a plain
 * `v.union([v.string(), v.number()])`: same success, same output, same issue messages, same JSON Schema.
 * @module
 */

import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { Decimal, Integer, UnsignedDecimal, UnsignedInteger } from "../../src/api/_schemas.ts";
import { valibotToJsonSchema } from "./_utils/valibotToJsonSchema.ts";

type PipedSchema = v.GenericSchema & {
  pipe: readonly [v.GenericSchema, ...v.PipeItem<unknown, unknown, v.BaseIssue<unknown>>[]];
};

/** The schema with its leading union replaced by valibot's own, unoptimized one. */
function reference(schema: PipedSchema): v.GenericSchema {
  const [, ...rest] = schema.pipe;
  return (v.pipe as any)(v.union([v.string(), v.number()]), ...rest);
}

const INPUTS: unknown[] = [
  0,
  -0,
  1,
  -1,
  42,
  1.5,
  -2.25,
  1e21,
  1e-7,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER + 2,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  "0",
  "1",
  "-1",
  "1.50",
  "0.001",
  "1e3",
  "",
  " 1",
  "abc",
  "NaN",
  "Infinity",
  null,
  undefined,
  true,
  false,
  10n,
  {},
  [],
  [1],
  { value: 1 },
  new Number(5),
  new String("5"),
];

const SCHEMAS = { UnsignedDecimal, Decimal, Integer, UnsignedInteger } as unknown as Record<string, PipedSchema>;

describe("short-circuited string | number union", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    test(`${name} parses exactly like the plain union`, () => {
      const ref = reference(schema);
      for (const input of INPUTS) {
        const actual = v.safeParse(schema, input);
        const expected = v.safeParse(ref, input);
        const label = `${name}(${typeof input === "bigint" ? `${input}n` : String(input)})`;
        expect(actual.success, label).toBe(expected.success);
        expect(actual.output, label).toEqual(expected.output);
        expect(
          actual.issues?.map((issue) => issue.message),
          label,
        ).toEqual(expected.issues?.map((issue) => issue.message));
      }
    });

    test(`${name} generates the same JSON Schema`, () => {
      expect(valibotToJsonSchema(schema as never)).toEqual(valibotToJsonSchema(reference(schema) as never));
    });
  }
});
