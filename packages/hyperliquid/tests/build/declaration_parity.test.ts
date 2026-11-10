/**
 * Locks the declaration-parity rule CI applies to tsrs versus TypeScript 5.9.
 *
 * Union-member order and property order in object types are the differences measured when declaration emit moved
 * to tsrs. A change of type, an added member, tuple order, parameter order and overload order are not.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { compareDeclarationDirectories, declarationsMatch } from "../../.dev/build/declaration_parity.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");

describe("declarationsMatch", () => {
  test("accepts the union-member order TypeScript 7 prints", () => {
    const typescript5 = `export type Names = "~types" | "~run" | "~standard" | "entries";\n`;
    const tsrs = `export type Names = "entries" | "~run" | "~standard" | "~types";\n`;
    expect(declarationsMatch(typescript5, tsrs)).toBe(true);
  });

  test("accepts property order inside an inferred object type", () => {
    const typescript5 = `export type Action = { agentName?: string | null | undefined; agentAddress: string };\n`;
    const tsrs = `export type Action = { agentAddress: string; agentName?: string | null | undefined };\n`;
    expect(declarationsMatch(typescript5, tsrs)).toBe(true);
  });

  test("accepts a union nested in a type argument together with a property reorder", () => {
    const typescript5 = `export type Action = { b: "~types" | "~run" | "entries"; a: string };\n`;
    const tsrs = `export type Action = { a: string; b: "entries" | "~run" | "~types" };\n`;
    expect(declarationsMatch(typescript5, tsrs)).toBe(true);
  });

  test("accepts property reordering around a method without moving the method", () => {
    const typescript5 = `export interface Box { b: string; m(): void; a: number; }\n`;
    const tsrs = `export interface Box { a: number; m(): void; b: string; }\n`;
    expect(declarationsMatch(typescript5, tsrs)).toBe(true);
  });

  test("rejects a property whose type changed under a reorder", () => {
    const typescript5 = `export type Action = { b: string; a: number };\n`;
    const changed = `export type Action = { a: string; b: number };\n`;
    expect(declarationsMatch(typescript5, changed)).toBe(false);
  });

  test("rejects an added property", () => {
    const before = `export type Action = { a: string };\n`;
    const after = `export type Action = { a: string; b: number };\n`;
    expect(declarationsMatch(before, after)).toBe(false);
  });

  test("rejects a union member that was replaced", () => {
    const typescript5 = `export type Names = "entries" | "~run";\n`;
    const changed = `export type Names = "entries" | "~types";\n`;
    expect(declarationsMatch(typescript5, changed)).toBe(false);
  });

  test("rejects tuple reordering", () => {
    const left = `export type Pair = [string, number];\n`;
    const right = `export type Pair = [number, string];\n`;
    expect(declarationsMatch(left, right)).toBe(false);
  });

  test("rejects parameter reordering", () => {
    const left = `export type Fn = (a: string, b: number) => void;\n`;
    const right = `export type Fn = (a: number, b: string) => void;\n`;
    expect(declarationsMatch(left, right)).toBe(false);
  });

  test("rejects method overload reordering", () => {
    const left = `export interface Box { m(x: string): void; m(x: number): void; }\n`;
    const right = `export interface Box { m(x: number): void; m(x: string): void; }\n`;
    expect(declarationsMatch(left, right)).toBe(false);
  });

  test("rejects a whitespace-only edit", () => {
    const left = `export type Action = { a: string };\n`;
    const right = `export type Action = { a:  string };\n`;
    expect(declarationsMatch(left, right)).toBe(false);
  });
});

describe("compareDeclarationDirectories", () => {
  test("counts an ordering difference and rejects a file present on only one side", async () => {
    const root = await mkdtemp(join(tmpdir(), "hl-decl-"));
    try {
      const left = join(root, "left");
      const right = join(root, "right");
      await mkdir(join(left, "api"), { recursive: true });
      await mkdir(join(right, "api"), { recursive: true });
      await writeFile(join(left, "api", "order.d.ts"), `export type Names = "b" | "a";\n`);
      await writeFile(join(right, "api", "order.d.ts"), `export type Names = "a" | "b";\n`);
      await writeFile(join(left, "api", "only.d.ts"), `export type Extra = string;\n`);
      const report = await compareDeclarationDirectories(left, right);
      expect(report.compared).toBe(1);
      expect(report.orderOnly).toBe(1);
      expect(report.differences.map((difference) => difference.file)).toEqual(["api/only.d.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a tree with no declarations", async () => {
    const root = await mkdtemp(join(tmpdir(), "hl-decl-"));
    try {
      const left = join(root, "left");
      const right = join(root, "right");
      await mkdir(left);
      await mkdir(right);
      await writeFile(join(left, "mod.js"), "export {}\n");
      const report = await compareDeclarationDirectories(left, right);
      expect(report.compared).toBe(0);
      expect(report.differences.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("declaration parity CLI", () => {
  test("exits 0 for an ordering difference and 1 for a type change", async () => {
    const root = await mkdtemp(join(tmpdir(), "hl-decl-cli-"));
    try {
      const tsrs = join(root, "tsrs");
      const tsc = join(root, "tsc");
      const broken = join(root, "broken");
      await mkdir(tsrs);
      await mkdir(tsc);
      await mkdir(broken);
      await writeFile(join(tsrs, "mod.d.ts"), `export type Names = "entries" | "~types";\n`);
      await writeFile(join(tsc, "mod.d.ts"), `export type Names = "~types" | "entries";\n`);
      await writeFile(join(broken, "mod.d.ts"), `export type Names = "~types" | "missing";\n`);
      const script = join(repoRoot, "packages/hyperliquid/.dev/build/declaration_parity.ts");
      const pass = Bun.spawn([process.execPath, script, tsrs, tsc], { stdout: "pipe", stderr: "pipe" });
      const fail = Bun.spawn([process.execPath, script, tsrs, broken], { stdout: "pipe", stderr: "pipe" });
      const [passCode, failCode, passOut, failErr] = await Promise.all([
        pass.exited,
        fail.exited,
        new Response(pass.stdout).text(),
        new Response(fail.stderr).text(),
      ]);
      expect(passCode).toBe(0);
      expect(passOut).toContain("1 differed only by union or object-member order");
      expect(failCode).toBe(1);
      expect(failErr).toContain("mod.d.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
