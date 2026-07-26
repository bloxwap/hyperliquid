import { type VaultDetailsParameters, VaultDetailsRequest, vaultDetails } from "@bloxwap/hyperliquid/api/info";
import * as v from "valibot";
import { describe, test } from "bun:test";
import { assertEquals } from "@jsr/std__assert";
import type { IRequestTransport } from "@bloxwap/hyperliquid";
import { schemaCoverage } from "../_utils/schemaCoverage.ts";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";
import { valibotToJsonSchema } from "../_utils/valibotToJsonSchema.ts";
import { runTest } from "./_t.ts";

const sourceFile = new URL("../../../src/api/info/_methods/vaultDetails.ts", import.meta.url).pathname;
const responseSchema = typeToJsonSchema(sourceFile, "VaultDetailsResponse");
const paramsSchema = valibotToJsonSchema(v.omit(VaultDetailsRequest, ["type"]));

runTest({
  name: "vaultDetails",
  codeTestFn: async (_t, client) => {
    const params: VaultDetailsParameters[] = [
      { vaultAddress: "0x1719884eb866cb12b2287399b15f7db5e7d775ea" }, // relationship.type = normal, user absent
      { vaultAddress: "0x768484f7e2ebb675c57838366c02ae99ba2a9b08", user: null }, // relationship.type = child, user null
      {
        vaultAddress: "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0",
        user: "0xe019d6167E7e324aEd003d94098496b6d986aB05",
      }, // relationship.type = parent, user present
      { vaultAddress: "0x0000000000000000000000000000000000000001" }, // nonexistent vault, null response
    ];

    const data = await Promise.all(params.map((p) => client.vaultDetails(p)));

    schemaCoverage(paramsSchema, params);
    schemaCoverage(responseSchema, data);
  },
});

// ============================================================
// Offline: the API returns `null` for unknown vaults
// ============================================================

describe("vaultDetails (offline)", () => {
  test("nonexistent vault address resolves to null", async () => {
    const transport: IRequestTransport = {
      isTestnet: true,
      request<T>(): Promise<T> {
        return Promise.resolve(null as T);
      },
    };

    const result = await vaultDetails({ transport }, { vaultAddress: "0x0000000000000000000000000000000000000001" });

    assertEquals(result, null);
  });
});
