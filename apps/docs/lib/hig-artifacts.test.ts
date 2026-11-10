import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readOgFont } from "@bloxwap/hig/og-fonts/node";

const root = resolve(import.meta.dir, "../../..");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const version = "0.2.0";
const packageName = "@bloxwap/hig";
/** 0.1 published these as separate packages. 0.2.0 replaced them with one package. */
const retired = [
  "@bloxwap/hig-react",
  "@bloxwap/hig-tokens",
  "@bloxwap/hig-contracts",
  "@bloxwap/hig-og-fonts",
] as const;
const entries = [
  "@bloxwap/hig/react/provider",
  "@bloxwap/hig/react/button",
  "@bloxwap/hig/react/status",
  "@bloxwap/hig/react/css",
  "@bloxwap/hig/react/css/base",
  "@bloxwap/hig/tokens",
  "@bloxwap/hig/tokens/css",
  "@bloxwap/hig/contracts",
  "@bloxwap/hig/og-fonts/node",
  "@bloxwap/hig/og-fonts/manifest",
] as const;

function installedPackage(name: string, entry = name, from = import.meta.dir) {
  let directory = dirname(Bun.resolveSync(entry, from));
  while (dirname(directory) !== directory) {
    const path = resolve(directory, "package.json");
    if (existsSync(path)) {
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      if (manifest.name === name) return { manifest, directory };
    }
    directory = dirname(directory);
  }
  throw new Error(`Cannot locate installed package ${name}`);
}

describe("unified HIG registry package", () => {
  test("installs @bloxwap/hig without the retired split packages, candidate archives, or overrides", () => {
    const app = JSON.parse(readFileSync(resolve(root, "apps/docs/package.json"), "utf8"));
    const workspace = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const lock = readFileSync(resolve(root, "bun.lock"), "utf8");
    expect(app.dependencies[packageName]).toBe(version);
    for (const name of retired) expect(app.dependencies[name]).toBeUndefined();
    const installed = installedPackage(packageName, "@bloxwap/hig/react/provider");
    expect(installed.manifest.version).toBe(version);
    for (const entry of entries) expect(installedPackage(packageName, entry).directory).toBe(installed.directory);
    const bundled = Object.keys(installed.manifest.dependencies ?? {}).filter((name) =>
      name.startsWith("@bloxwap/hig"),
    );
    expect(bundled).toEqual([]);
    expect(Object.keys(workspace.overrides).filter((name) => name.startsWith("@bloxwap/hig"))).toEqual([]);
    expect(lock).not.toContain("vendor/bloxwap-hig");
    expect(lock).not.toContain("0.1.0-candidate");
    for (const name of retired) expect(lock).not.toContain(name);
  });

  test("loads the actual OG Bold/Black bytes verified against the shipped font manifest", async () => {
    const fonts = JSON.parse(readFileSync(Bun.resolveSync("@bloxwap/hig/og-fonts/manifest", import.meta.dir), "utf8"));
    for (const face of ["BloxwapSans-Bold.ttf", "BloxwapSans-Black.ttf"] as const) {
      const data = await readOgFont(face);
      expect(digest(data)).toBe(fonts.outputs[face]);
      expect(data.byteLength).toBeGreaterThan(10_000);
    }
  });
});
