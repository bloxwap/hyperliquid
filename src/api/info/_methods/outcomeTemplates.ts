import * as v from "valibot";

// ============================================================
// API Schemas
// ============================================================

/**
 * Request outcome templates.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#read-api
 */
export const OutcomeTemplatesRequest = /* @__PURE__ */ (() => {
  return v.object({
    /** Type of request. */
    type: v.literal("outcomeTemplates"),
  });
})();
export type OutcomeTemplatesRequest = v.InferOutput<typeof OutcomeTemplatesRequest>;

/**
 * Array of templates that outcome deployers instantiate.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#read-api
 */
export type OutcomeTemplatesResponse = {
  /** Template identifier. */
  id: string;
  /** Role of the template. */
  role:
    | {
        /** Deploys a single outcome. */
        standaloneOutcome: {
          /** Names of the Yes and No sides. */
          sideNames: [string, string];
        };
      }
    | {
        /** Deploys an outcome under an existing question template. */
        questionOutcome: {
          /** Identifier of the parent question template. */
          parent: string;
        };
      }
    /** Deploys a question. */
    | "question";
  /** Display name containing `{keyword}` placeholders. */
  name: string;
  /** Description containing `{keyword}` placeholders. */
  description: string;
  /**
   * Keywords of the template and the value format of each:
   * - `dateTime` = `%Y%m%d-%H%M`, within the next year; e.g. `20260712-1830`.
   * - `date` = `YYYYMMDD` (end of day), within the next year; e.g. `20260712`.
   * - `string` = free text.
   * - `hlPerp` = coin name of an existing perp; e.g. `ABC` or `test:ABC`.
   * - `uDecimal` = unsigned decimal.
   * - `uInt` = unsigned integer.
   * - `shortString` = short free text.
   *
   * Note: `uDecimal`, `uInt`, and `shortString` are served by testnet but absent from the upstream reference schema.
   */
  keywords: [string, "dateTime" | "date" | "string" | "hlPerp" | "uDecimal" | "uInt" | "shortString"][];
}[];

// ============================================================
// Execution Logic
// ============================================================

import { parse } from "../../../_base.ts";
import type { InfoConfig } from "./_base/mod.ts";

/**
 * Request outcome templates.
 *
 * @param config General configuration for Info API requests.
 * @param signal {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | AbortSignal} to cancel the request.
 * @return Array of templates that outcome deployers instantiate.
 *
 * @throws {ValidationError} When the request parameters fail validation (before sending).
 * @throws {TransportError} When the transport layer throws an error.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@bloxwap/hyperliquid";
 * import { outcomeTemplates } from "@bloxwap/hyperliquid/api/info";
 *
 * const transport = new HttpTransport(); // or `WebSocketTransport`
 *
 * const data = await outcomeTemplates({ transport });
 * ```
 *
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#read-api
 */
export function outcomeTemplates(config: InfoConfig, signal?: AbortSignal): Promise<OutcomeTemplatesResponse> {
  const request = parse(OutcomeTemplatesRequest, {
    type: "outcomeTemplates",
  });
  return config.transport.request("info", request, signal);
}
