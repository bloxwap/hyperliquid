import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readOgFont } from "@bloxwap/hig-og-fonts/node";

const root = resolve(import.meta.dir, "../../..");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const version = "0.1.0";

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

describe("coordinated HIG registry packages", () => {
  test("installs exact published versions without candidate archives or overrides", () => {
    const app = JSON.parse(readFileSync(resolve(root, "apps/docs/package.json"), "utf8"));
    const workspace = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const lock = readFileSync(resolve(root, "bun.lock"), "utf8");
    const react = installedPackage("@bloxwap/hig-react", "@bloxwap/hig-react/provider");
    for (const [name, entry] of [
      ["@bloxwap/hig-react", "@bloxwap/hig-react/provider"],
      ["@bloxwap/hig-tokens", "@bloxwap/hig-tokens"],
      ["@bloxwap/hig-og-fonts", "@bloxwap/hig-og-fonts/node"],
    ]) {
      expect(app.dependencies[name!]).toBe(version);
      expect(installedPackage(name!, entry).manifest.version).toBe(version);
    }
    expect(installedPackage("@bloxwap/hig-contracts", "@bloxwap/hig-contracts", react.directory).manifest.version).toBe(
      version,
    );
    for (const [name, value] of Object.entries(react.manifest.dependencies)) {
      if (name.startsWith("@bloxwap/hig-")) expect(value).toBe(version);
    }
    expect(Object.keys(workspace.overrides).filter((name) => name.startsWith("@bloxwap/hig-"))).toEqual([]);
    expect(lock).not.toContain("vendor/bloxwap-hig");
    expect(lock).not.toContain("0.1.0-candidate");
    expect(existsSync(resolve(root, "vendor/bloxwap-hig"))).toBe(false);
  });

  test("loads the actual OG Bold/Black bytes verified against the shipped font manifest", async () => {
    const fonts = JSON.parse(readFileSync(Bun.resolveSync("@bloxwap/hig-og-fonts/manifest", import.meta.dir), "utf8"));
    for (const face of ["BloxwapSans-Bold.ttf", "BloxwapSans-Black.ttf"] as const) {
      const data = await readOgFont(face);
      expect(digest(data)).toBe(fonts.outputs[face]);
      expect(data.byteLength).toBeGreaterThan(10_000);
    }
  });
});
