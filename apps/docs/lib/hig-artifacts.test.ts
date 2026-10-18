import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readOgFont } from "@bloxwap/hig-og-fonts/node";

const root = resolve(import.meta.dir, "../../..");
const vendor = resolve(root, "vendor/bloxwap-hig");
const manifest = JSON.parse(readFileSync(resolve(vendor, "manifest.json"), "utf8"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("immutable coordinated HIG candidate", () => {
  test("retains the clean source report and exact archive hashes/versions", () => {
    const source = readFileSync(resolve(vendor, manifest.sourceReport));
    expect(digest(source)).toBe(manifest.sourceReportSha256);
    const report = JSON.parse(source.toString());
    expect(report.sourceTreeDirty).toBe(false);
    expect(report.sourceCommit).toBe(manifest.sourceCommit);
    expect(report.artifactVersion).toBe(manifest.version);
    for (const [file, entry] of Object.entries(manifest.artifacts) as [string, { bytes: number; sha256: string }][]) {
      const bytes = readFileSync(resolve(vendor, file));
      expect(bytes.byteLength).toBe(entry.bytes);
      expect(digest(bytes)).toBe(entry.sha256);
      expect(report.artifacts.find((item: { file: string }) => item.file === file)?.sha256).toBe(entry.sha256);
      const extracted = Bun.spawnSync(["tar", "-xOf", resolve(vendor, file), "package/package.json"]);
      expect(extracted.exitCode).toBe(0);
      const pkg = JSON.parse(extracted.stdout.toString());
      expect(pkg.version).toBe(manifest.version);
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        if (name.startsWith("@bloxwap/hig-")) expect(version).toBe(manifest.version);
      }
    }
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
