/**
 * Tests for {@linkcode InfoRequestOptions}: the trailing `signalOrOptions` argument every Info
 * API method accepts — a bare `AbortSignal` (backward compatible) or an options object — and its
 * opt-in `skipValidation` escape hatch, which bypasses the request-schema parse for trusted,
 * performance-critical callers.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { InfoClient, ValidationError } from "@bloxwap/hyperliquid";
import { allMids, clearinghouseState, exchangeStatus } from "@bloxwap/hyperliquid/api/info";
import { MockInfoTransport } from "./_mockInfoTransport.ts";

/** A valid mainnet-style address, already lowercase. */
const USER = "0x0000000000000000000000000000000000000001";
/** The same shape but uppercase: the `Address` schema lowercases it when validation runs. */
const UPPERCASE_USER = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("InfoRequestOptions", () => {
  describe("skipValidation", () => {
    test("default behavior validates: invalid params throw before any request (function and client)", () => {
      const transport = new MockInfoTransport(() => ({}));
      const client = new InfoClient({ transport });

      expect(() => clearinghouseState({ transport }, { user: "not-an-address" })).toThrow(ValidationError);
      expect(() => client.clearinghouseState({ user: "not-an-address" })).toThrow(ValidationError);

      expect(transport.calls).toHaveLength(0); // validation happens before sending
    });

    test("{ skipValidation: false } validates exactly like the default", () => {
      const transport = new MockInfoTransport(() => ({}));

      expect(() => clearinghouseState({ transport }, { user: "not-an-address" }, { skipValidation: false })).toThrow(
        ValidationError,
      );

      expect(transport.calls).toHaveLength(0);
    });

    test("{ skipValidation: true } sends invalid params to the transport verbatim (function and client)", async () => {
      const transport = new MockInfoTransport(() => ({}));
      const client = new InfoClient({ transport });

      await clearinghouseState({ transport }, { user: "not-an-address" }, { skipValidation: true });
      await client.clearinghouseState({ user: "not-an-address" }, { skipValidation: true });

      expect(transport.calls).toEqual([
        { endpoint: "info", payload: { type: "clearinghouseState", user: "not-an-address" }, signal: undefined },
        { endpoint: "info", payload: { type: "clearinghouseState", user: "not-an-address" }, signal: undefined },
      ]);
    });

    test("{ skipValidation: true } skips normalization: an uppercase address is NOT lowercased", async () => {
      const transport = new MockInfoTransport(() => ({}));

      // The validated path normalizes: the Address schema transform lowercases the address.
      await clearinghouseState({ transport }, { user: UPPERCASE_USER });
      expect(transport.calls[0].payload).toEqual({ type: "clearinghouseState", user: UPPERCASE_USER.toLowerCase() });

      // The skipped path posts the params exactly as given.
      await clearinghouseState({ transport }, { user: UPPERCASE_USER }, { skipValidation: true });
      expect(transport.calls[1].payload).toEqual({ type: "clearinghouseState", user: UPPERCASE_USER });
    });
  });

  describe("trailing signalOrOptions", () => {
    test("a bare AbortSignal and { signal } both reach the transport (function and client)", async () => {
      const transport = new MockInfoTransport(() => ({}));
      const client = new InfoClient({ transport });
      const first = new AbortController().signal;
      const second = new AbortController().signal;

      await clearinghouseState({ transport }, { user: USER }, first);
      await clearinghouseState({ transport }, { user: USER }, { signal: second });
      await client.clearinghouseState({ user: USER }, { signal: first });

      expect(transport.calls.map((call) => call.signal)).toEqual([first, second, first]);
    });

    test("no-params methods accept a bare signal and an options object", async () => {
      const transport = new MockInfoTransport(() => ({}));
      const client = new InfoClient({ transport });
      const signal = new AbortController().signal;

      // Parameterless: the options object IS the trailing argument.
      await exchangeStatus({ transport }, { skipValidation: true });
      await exchangeStatus({ transport }, signal);
      await client.exchangeStatus({ skipValidation: true });
      expect(transport.calls.map((call) => call.payload)).toEqual([
        { type: "exchangeStatus" },
        { type: "exchangeStatus" },
        { type: "exchangeStatus" },
      ]);
      expect(transport.calls[1].signal).toBe(signal);

      // Overloaded: params come second, options third (an options object in the params
      // position is params, as before).
      await allMids({ transport }, {}, { skipValidation: true });
      await allMids({ transport }, signal); // the bare-signal overload still works
      await client.allMids({}, { skipValidation: true });
      expect(transport.calls.slice(3).map((call) => call.payload)).toEqual([
        { type: "allMids" },
        { type: "allMids" },
        { type: "allMids" },
      ]);
      expect(transport.calls[4].signal).toBe(signal);
    });

    test("{ skipValidation: true } combines with { signal }", async () => {
      const transport = new MockInfoTransport(() => ({}));
      const signal = new AbortController().signal;

      await clearinghouseState({ transport }, { user: "not-an-address" }, { signal, skipValidation: true });

      expect(transport.calls).toEqual([
        { endpoint: "info", payload: { type: "clearinghouseState", user: "not-an-address" }, signal },
      ]);
    });
  });
});
