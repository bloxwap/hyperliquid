/**
 * Shared offline battery for Info API methods over {@linkcode MockInfoTransport}.
 *
 * Every Info method body is the same shape — validate params against the request schema, send one
 * `info` request, return the transport's response — so each method's test file runs this battery:
 * the exact wire payload for every valid-params combo, a {@linkcode ValidationError} and zero
 * requests for invalid params, response/error/signal passthrough, and identical behavior through
 * the {@linkcode InfoClient} wrapper.
 *
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient, ValidationError } from "@bloxwap/hyperliquid";
import { MockInfoTransport } from "./_mockInfoTransport.ts";

/** A valid-params case for {@linkcode runOfflineMethodTests}. */
export interface OfflineMethodCase {
  /** Params handed to the method. */
  params: Record<string, unknown>;
  /** Expected wire payload after request-schema validation; defaults to `{ type: <name>, ...params }`. */
  payload?: Record<string, unknown>;
}

/** How the method (and its InfoClient wrapper) takes its arguments. */
export type OfflineMethodSignature =
  /** `(params, signal?)` */
  | "params"
  /** `(signal?)` — parameterless endpoint */
  | "none"
  /** `(params?, signal?)` or `(signal?)` — params optional via an overload */
  | "overloaded";

// The battery drives every method shape through one signature; each call site passes the right
// arguments for its declared `signature` mode.
type AnyInfoMethod = (config: { transport: MockInfoTransport }, ...args: any[]) => Promise<unknown>;

/**
 * Registers the offline battery for one Info API method as `describe("<name> (offline request)")`.
 *
 * @param options.name Method name; also the request `type` and the InfoClient method name.
 * @param options.method The standalone method function.
 * @param options.signature How the method takes its arguments (see {@linkcode OfflineMethodSignature}).
 * @param options.cases Valid-params cases; ignored for `signature: "none"` (one bare request is tested).
 * @param options.invalidParams Params that must fail request-schema validation; omit when no input can be invalid.
 */
export function runOfflineMethodTests(options: {
  name: string;
  method: AnyInfoMethod;
  signature: OfflineMethodSignature;
  cases?: OfflineMethodCase[];
  invalidParams?: Record<string, unknown>[];
}): void {
  const { name, method, signature, cases = [{ params: {} }], invalidParams = [] } = options;
  const payloadOf = (c: OfflineMethodCase): Record<string, unknown> => c.payload ?? { type: name, ...c.params };

  const callMethod = (transport: MockInfoTransport, c: OfflineMethodCase, signal?: AbortSignal): Promise<unknown> =>
    signature === "none" ? method({ transport }, signal) : method({ transport }, c.params, signal);

  const callClient = (client: InfoClient, c: OfflineMethodCase, signal?: AbortSignal): Promise<unknown> => {
    const fn = (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
    return signature === "none" ? fn.call(client, signal) : fn.call(client, c.params, signal);
  };

  describe(`${name} (offline request)`, () => {
    test("sends one request with the exact payload and returns the transport's response", async () => {
      for (const c of cases) {
        const response = { sentinel: name };
        const transport = new MockInfoTransport(() => response);
        const signal = new AbortController().signal;

        const result = await callMethod(transport, c, signal);

        expect(result).toBe(response); // the method returns the transport's response untouched
        expect(transport.calls).toEqual([{ endpoint: "info", payload: payloadOf(c), signal }]);
      }
    });

    if (invalidParams.length > 0) {
      test("rejects invalid params before any request", () => {
        for (const params of invalidParams) {
          const transport = new MockInfoTransport(() => ({}));

          expect(() => method({ transport }, params)).toThrow(ValidationError);

          expect(transport.calls).toHaveLength(0); // validation happens before sending
        }
      });
    }

    test("propagates transport errors", async () => {
      const error = new Error("transport boom");
      const transport = new MockInfoTransport(() => {
        throw error;
      });

      await expect(callMethod(transport, cases[0])).rejects.toBe(error);
    });

    test("is exposed on InfoClient with identical behavior", async () => {
      for (const c of cases) {
        const response = { sentinel: name };
        const transport = new MockInfoTransport(() => response);
        const client = new InfoClient({ transport });
        const signal = new AbortController().signal;

        const result = await callClient(client, c, signal);

        expect(result).toBe(response);
        expect(transport.calls).toEqual([{ endpoint: "info", payload: payloadOf(c), signal }]);
      }
    });

    if (signature === "overloaded") {
      test("accepts a bare AbortSignal or no argument in place of params (function and client)", async () => {
        for (const viaClient of [false, true]) {
          for (const arg of ["signal", "absent"] as const) {
            const transport = new MockInfoTransport(() => null);
            const client = new InfoClient({ transport });
            const fn = (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
            const signal = new AbortController().signal;

            if (arg === "signal") {
              await (viaClient ? fn.call(client, signal) : method({ transport }, signal));
              expect(transport.calls).toEqual([{ endpoint: "info", payload: { type: name }, signal }]);
            } else {
              await (viaClient ? fn.call(client) : method({ transport }));
              expect(transport.calls).toEqual([{ endpoint: "info", payload: { type: name } }]);
              expect(transport.calls[0].signal).toBeUndefined();
            }
          }
        }
      });
    }
  });
}
