// ============================================================
// Execution Logic
// ============================================================

import { HyperliquidError } from "../../../_base.ts";
import type { IRequestTransport } from "../../../transport/mod.ts";
import type { ExchangeConfig, PreparedExchangeRequest } from "./_base/mod.ts";
import { linkPreparedRequestState, type PreparedRequestState } from "./_base/_shell.ts";

export type { PreparedExchangeRequest } from "./_base/mod.ts";

/**
 * Success stub handed to the method being prepared: responses are not validated, and the shell
 * only checks for error shapes, so a minimal `ok` envelope lets every method run to completion
 * while its real request is captured instead of posted.
 */
const CAPTURE_SUCCESS = { status: "ok", response: { type: "default" } } as const;

/**
 * The minimal shape of a signed exchange request, as {@linkcode PreparedExchangeRequest}
 * documents it: a non-null, non-array object carrying a non-array `action` object, a non-array
 * `signature` object, and a nonnegative safe-integer `nonce`.
 *
 * Returns a shallow plain-object COPY of a valid payload (or `undefined` for anything
 * malformed). The copy is what gets returned and poison-linked, so a frozen direct payload
 * survives the `delete` of unset optional keys at finalize (strict mode would throw on the
 * original), and every later touch of the captured payload is guarded by construction. The
 * whole inspection is wrapped in try/catch: a payload whose getters or Proxy traps throw is
 * treated as malformed — the "never a raw TypeError" contract holds.
 */
function toPlainSignedRequest(payload: unknown): PreparedExchangeRequest<unknown> | undefined {
  try {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
    const candidate = payload as Record<string, unknown>;
    const { action, signature, nonce } = candidate;
    if (
      typeof action !== "object" ||
      action === null ||
      Array.isArray(action) ||
      typeof signature !== "object" ||
      signature === null ||
      Array.isArray(signature) ||
      typeof nonce !== "number" ||
      !Number.isSafeInteger(nonce) ||
      nonce < 0
    ) {
      return undefined;
    }
    return { ...(payload as PreparedExchangeRequest<unknown>) };
  } catch {
    return undefined;
  }
}

/**
 * Build a fully signed Exchange request without sending it (sign now, submit later).
 *
 * Runs `run` against a capture transport: the callback executes any Exchange method exactly as
 * usual (validation, nonce issuance, signing), but the resulting request is captured instead of
 * being posted. The returned payload can be submitted later with {@linkcode submitPrepared} —
 * useful for latency-critical flows (e.g. a pre-signed cancel-all fired with zero signing latency).
 *
 * The nonce is consumed at prepare time: it is fresh and monotonic when the payload is signed.
 * **A prepared payload stays valid while its nonce is among the 100 highest the exchange has seen
 * from the wallet** (and within the block-timestamp window) — another request consuming a later
 * nonce does NOT invalidate it; it goes stale only after 100 newer nonces have been consumed.
 * Prepare immediately before use anyway: the fewer intervening requests, the longer the payload
 * stays submittable.
 *
 * The callback must issue exactly one request (one Exchange method call) to the `exchange`
 * endpoint. Exactly-one is enforced — synchronously recorded, fail-closed at finalize — for
 * every attempt that reaches the capture transport before the callback's returned promise
 * settles: any invalid attempt arriving within that window — a request to a non-`exchange`
 * endpoint or a second request — fails the whole `prepareRequest` call, even if the callback
 * swallowed the rejection.
 *
 * The callback contract is the exported Exchange methods (e.g. `order`, `cancel`). Direct
 * `transport.request("exchange", ...)` calls are supported only with well-formed signed
 * payloads (`{ action, signature, nonce }`) and are validated defensively: malformed payloads —
 * including ones whose getters or Proxy traps throw — are recorded as invalid attempts and
 * rejected with a contract error, and a valid direct payload is copied before any mutation
 * (frozen objects are safe).
 *
 * Limitations (beyond callback settle, enforcement is best-effort):
 * - An attempt that reaches the capture transport only after the callback settled — a floating
 *   (un-awaited) attempt fired as the callback returns, whose signing path spans several
 *   microtasks past the settle microtask, or leaked callback work beginning later (e.g. still
 *   awaiting a remote signer) — cannot be caught at prepare time; it poisons the payload
 *   instead: the attempt's own promise rejects, and `submitPrepared` re-checks the poison flag
 *   synchronously before posting and rejects a poisoned payload.
 * - The poison guard is in-process only: the payload-to-state link lives in a `WeakMap`, so
 *   serializing and re-parsing a payload silently drops the guard.
 * - `submitPrepared`'s re-check is a point-in-time check, not a happens-before guarantee: an
 *   attempt landing after the check but before or during the actual post is not caught.
 * - A leaked attempt whose promise is discarded (`void order(...)`) rejects unobserved — an
 *   unhandledRejection by definition. The rejection is delivered to the attempt's own promise;
 *   observing it is the leaker's responsibility, not something the SDK can prevent.
 *
 * @param config General configuration for Exchange API requests.
 * @param run Callback that issues one Exchange API request (e.g. `(config) => order(config, params)`).
 * @return The signed request payload (`{ action, signature, nonce, ... }`), ready for {@linkcode submitPrepared}.
 *
 * @throws {ValidationError} When the request parameters fail validation (before signing).
 * @throws {HyperliquidError} When the callback issues zero or more than one request, targets a non-`exchange` endpoint, or issues a malformed request.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { order, prepareRequest } from "@bloxwap/hyperliquid/api/exchange";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const wallet = privateKeyToAccount("0x...");
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const prepared = await prepareRequest({ transport, wallet }, (config) =>
 *   order(config, {
 *     orders: [{ a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }],
 *     grouping: "na",
 *   }),
 * );
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets#hyperliquid-nonces
 */
export async function prepareRequest<T>(
  config: ExchangeConfig,
  run: (config: ExchangeConfig) => Promise<T>,
): Promise<PreparedExchangeRequest<T>> {
  // Shared with the returned payload (see `linkPreparedRequestState`): invalid attempts recorded
  // after finalization — possible only for leaked callback work — poison the payload so
  // `submitPrepared` rejects it (best-effort).
  const state: PreparedRequestState = { invalidAttempts: 0 };
  let captured: PreparedExchangeRequest<T> | undefined;
  let settled = false;
  const capture: IRequestTransport = {
    isTestnet: config.transport.isTestnet,
    request<TResponse>(endpoint: "info" | "exchange", payload: unknown, _signal?: AbortSignal): Promise<TResponse> {
      if (endpoint !== "exchange") {
        // Record the invalid attempt FIRST: even if the callback swallows this rejection, the
        // final validation below still fails the prepare.
        state.invalidAttempts++;
        return Promise.reject(
          new HyperliquidError(
            `prepareRequest: the callback issued a request to the "${endpoint}" endpoint; only "exchange" requests can be prepared`,
          ),
        );
      }
      if (settled) {
        // A request attempted after finalization means the callback leaked un-awaited work.
        // Record it (poisoning the payload) and reject: the rejection is delivered to the
        // attempt's own promise. Observing it is the leaker's responsibility — a discarded
        // (`void`) promise is an unhandledRejection by definition, which the SDK cannot prevent.
        state.invalidAttempts++;
        return Promise.reject(
          new HyperliquidError(
            "prepareRequest: request attempted after the prepare callback settled (un-awaited request leaked from the callback)",
          ),
        );
      }
      if (captured !== undefined) {
        state.invalidAttempts++;
        return Promise.reject(new HyperliquidError("prepareRequest: the callback issued more than one request"));
      }
      const plain = toPlainSignedRequest(payload);
      if (plain === undefined) {
        // A callback hitting the capture transport directly with a primitive or malformed
        // payload: record the invalid attempt and reject with a contract error, never letting a
        // raw TypeError (property access on null, getter/Proxy traps, WeakMap key check) escape.
        state.invalidAttempts++;
        return Promise.reject(
          new HyperliquidError(
            "prepareRequest: the callback issued a malformed exchange request: expected an object with action/signature/nonce",
          ),
        );
      }
      captured = plain as PreparedExchangeRequest<T>;
      return Promise.resolve(CAPTURE_SUCCESS as TResponse);
    },
  };

  try {
    await run({ ...config, transport: capture });
  } finally {
    // Settle immediately — no drain tick. Attempts are enforced fail-closed only if they reach
    // the capture transport before the callback's returned promise settles; anything arriving
    // later — including a floating attempt fired as the callback returns (its signing path spans
    // several microtasks past this point) — takes the documented poison path instead. A
    // `setTimeout(0)` drain here cost ~1.2 ms per prepare (macrotask clamping) without widening
    // the guaranteed window to anything useful, so it was removed.
    settled = true;
  }

  if (captured === undefined) {
    throw new HyperliquidError("prepareRequest: the callback did not issue a request");
  }
  if (state.invalidAttempts > 0) {
    throw new HyperliquidError("prepareRequest: the callback issued more than one request");
  }
  // The shell spreads `vaultAddress`/`expiresAfter` into the payload even when unset; drop the
  // undefined keys so the prepared payload is exactly what goes over the wire (JSON transports
  // omit undefined), and so it survives a `JSON.stringify` round trip unchanged.
  if (captured.vaultAddress === undefined) delete captured.vaultAddress;
  if (captured.expiresAfter === undefined) delete captured.expiresAfter;
  linkPreparedRequestState(captured, state);
  return captured;
}
