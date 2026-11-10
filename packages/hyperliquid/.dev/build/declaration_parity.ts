/**
 * Compares declaration trees emitted by tsrs and by TypeScript 5.9 (`HL_TSC=tsc`).
 *
 * tsrs follows TypeScript 7's printer. Against TypeScript 5.9 that printer reorders union members and the
 * properties of inferred object types (valibot schema types under `api/exchange/_methods`). The two files contain
 * the same characters. Call signatures, method overloads, tuple elements and parameter lists stay in source order,
 * because that order is part of the type. A difference that is not one of those reorderings fails.
 *
 * CI builds the package twice, so each tree is the post-processed `dist/` (`.ts` specifiers already rewritten to
 * `.js`) and each build has already loaded the package in Node and type-checked it as a published consumer.
 *
 * @example
 * ```sh
 * bun run .dev/build/declaration_parity.ts "$RUNNER_TEMP/dts-tsrs" dist
 * ```
 *
 * @module
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

/** One declaration file that is not an allowed ordering difference. */
export interface DeclarationDifference {
  /** Path relative to the compared trees, using `/` separators. */
  file: string;
  /** Why the file failed the ordering-only rule. */
  detail: string;
}

/** Result of comparing every `.d.ts` file in two directories. */
export interface DeclarationParityReport {
  /** Declaration files that exist in both trees. */
  compared: number;
  /** Compared files whose raw text differed and that the ordering rule accepted. */
  orderOnly: number;
  /** Files the ordering rule rejected, including files present on only one side. */
  differences: readonly DeclarationDifference[];
}

const printer: ts.Printer = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
  omitTrailingSemicolon: false,
});

/**
 * True when both strings are the same multiset of UTF-16 code units.
 *
 * A pure reordering has this property. A changed type, comment, or token does not, so it is rejected before the
 * printer runs.
 */
function sameCharacters(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<number, number>();
  for (let index = 0; index < left.length; index++) {
    const code = left.charCodeAt(index);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  for (let index = 0; index < right.length; index++) {
    const code = right.charCodeAt(index);
    const next = (counts.get(code) ?? 0) - 1;
    if (next < 0) return false;
    counts.set(code, next);
  }
  return true;
}

/** Sorts union members by their printed text. Nested unions are already sorted by the time this runs. */
function sortUnion(node: ts.UnionTypeNode, sourceFile: ts.SourceFile): ts.UnionTypeNode {
  const types = [...node.types].sort((left, right) => {
    const leftText = printer.printNode(ts.EmitHint.Unspecified, left, sourceFile);
    const rightText = printer.printNode(ts.EmitHint.Unspecified, right, sourceFile);
    if (leftText < rightText) return -1;
    if (leftText > rightText) return 1;
    return 0;
  });
  if (types.every((type, index) => type === node.types[index])) return node;
  return ts.factory.createUnionTypeNode(ts.factory.createNodeArray(types));
}

/**
 * Reorders property signatures among the slots they already occupy.
 *
 * Call signatures, construct signatures, methods and index signatures stay where they are, so overload order is
 * still compared exactly. Returns undefined when every property is already in order.
 */
function sortPropertyMembers(
  members: ts.NodeArray<ts.TypeElement>,
  sourceFile: ts.SourceFile,
): ts.NodeArray<ts.TypeElement> | undefined {
  const properties: ts.PropertySignature[] = [];
  for (const member of members) {
    if (ts.isPropertySignature(member)) properties.push(member);
  }
  if (properties.length < 2) return undefined;
  const sorted = [...properties].sort((left, right) => {
    const leftName = left.name.getText(sourceFile);
    const rightName = right.name.getText(sourceFile);
    if (leftName < rightName) return -1;
    if (leftName > rightName) return 1;
    return 0;
  });
  let propertyIndex = 0;
  let changed = false;
  const next = members.map((member) => {
    if (!ts.isPropertySignature(member)) return member;
    const replacement = sorted[propertyIndex];
    propertyIndex += 1;
    if (replacement !== member) changed = true;
    return replacement ?? member;
  });
  if (!changed) return undefined;
  return ts.factory.createNodeArray(next);
}

/** Printer-normalizes union order and inferred property order so those differences compare equal. */
function normalizeDeclaration(source: string, fileName: string): string {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result = ts.transform(sourceFile, [
    (context) => {
      const visit = (node: ts.Node): ts.Node => {
        const visited = ts.visitEachChild(node, visit, context);
        if (ts.isUnionTypeNode(visited)) return sortUnion(visited, sourceFile);
        if (ts.isTypeLiteralNode(visited)) {
          const members = sortPropertyMembers(visited.members, sourceFile);
          return members ? ts.factory.updateTypeLiteralNode(visited, members) : visited;
        }
        if (ts.isInterfaceDeclaration(visited)) {
          const members = sortPropertyMembers(visited.members, sourceFile);
          return members
            ? ts.factory.updateInterfaceDeclaration(
                visited,
                visited.modifiers,
                visited.name,
                visited.typeParameters,
                visited.heritageClauses,
                members,
              )
            : visited;
        }
        return visited;
      };
      return (node) => ts.visitNode(node, visit, ts.isSourceFile) ?? node;
    },
  ]);
  const printed = printer.printFile(result.transformed[0] ?? sourceFile);
  result.dispose();
  return printed;
}

/**
 * True when two declaration texts are the same file or the same characters in the allowed order.
 *
 * @param left - Declaration text from one compiler.
 * @param right - Declaration text from the other compiler.
 */
export function declarationsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (!sameCharacters(left, right)) return false;
  return normalizeDeclaration(left, "file.d.ts") === normalizeDeclaration(right, "file.d.ts");
}

/** First differing lines, clipped so one huge inferred type cannot flood the log. */
function clipDiff(left: string, right: string): string {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const lines: string[] = [];
  const limit = Math.max(leftLines.length, rightLines.length);
  for (let index = 0; index < limit && lines.length < 40; index++) {
    const leftLine = leftLines[index] ?? "";
    const rightLine = rightLines[index] ?? "";
    if (leftLine === rightLine) continue;
    const clip = (line: string): string => (line.length <= 240 ? line : `${line.slice(0, 240)}…`);
    lines.push(`@@ line ${index + 1}`);
    lines.push(`- ${clip(leftLine)}`);
    lines.push(`+ ${clip(rightLine)}`);
  }
  if (lines.length === 0) return "(no line difference after normalization)";
  return lines.join("\n");
}

/** Walks a declaration tree. Keys are `/`-separated paths relative to `dir`. */
async function declarationFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (current: string, prefix: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path, relativePath);
      else if (entry.isFile() && entry.name.endsWith(".d.ts")) files.set(relativePath, path);
    }
  };
  await walk(dir, "");
  return files;
}

/**
 * Compares every `.d.ts` file under two directories. Other files (JavaScript, the manifest) are ignored.
 *
 * @param leftDir - First declaration tree, conventionally the tsrs build.
 * @param rightDir - Second declaration tree, conventionally the TypeScript 5.9 build.
 * @returns Counts plus every rejected file. An empty tree is a difference: a build that emits nothing is not a pass.
 */
export async function compareDeclarationDirectories(
  leftDir: string,
  rightDir: string,
): Promise<DeclarationParityReport> {
  const [leftFiles, rightFiles] = await Promise.all([declarationFiles(leftDir), declarationFiles(rightDir)]);
  const differences: DeclarationDifference[] = [];
  if (leftFiles.size === 0 || rightFiles.size === 0) {
    differences.push({
      file: ".",
      detail: `expected .d.ts files in both trees (left ${leftFiles.size}, right ${rightFiles.size})`,
    });
  }
  const paths = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort();
  let compared = 0;
  let orderOnly = 0;
  for (const file of paths) {
    const leftPath = leftFiles.get(file);
    const rightPath = rightFiles.get(file);
    if (!leftPath || !rightPath) {
      differences.push({
        file,
        detail: leftPath ? "missing from the second tree" : "missing from the first tree",
      });
      continue;
    }
    const [leftText, rightText] = await Promise.all([readFile(leftPath, "utf8"), readFile(rightPath, "utf8")]);
    compared += 1;
    if (leftText === rightText) continue;
    if (!sameCharacters(leftText, rightText)) {
      differences.push({
        file,
        detail: `not an ordering difference (the files do not contain the same characters)\n${clipDiff(leftText, rightText)}`,
      });
      continue;
    }
    const leftNormalized = normalizeDeclaration(leftText, file);
    const rightNormalized = normalizeDeclaration(rightText, file);
    if (leftNormalized === rightNormalized) {
      orderOnly += 1;
      continue;
    }
    differences.push({ file, detail: clipDiff(leftNormalized, rightNormalized) });
  }
  return { compared, orderOnly, differences };
}

/**
 * CLI entry. Exits with 1 when the trees are not an allowed ordering difference.
 *
 * @param args - Two directory paths.
 * @returns Process exit code.
 */
async function main(args: readonly string[]): Promise<number> {
  const left = args[0];
  const right = args[1];
  if (!left || !right || args.length !== 2) {
    console.error("usage: declaration_parity.ts <tsrs-dir> <tsc-dir>");
    return 1;
  }
  let report: DeclarationParityReport;
  try {
    report = await compareDeclarationDirectories(left, right);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
  const files = report.compared === 1 ? "file" : "files";
  const differences = report.differences.length === 1 ? "difference" : "differences";
  console.log(
    `Compared ${report.compared} declaration ${files} (${report.orderOnly} differed only by union or object-member order).`,
  );
  if (report.differences.length === 0) return 0;
  console.error(`${report.differences.length} declaration ${differences}:`);
  for (const difference of report.differences.slice(0, 20)) {
    console.error(`\n${difference.file}\n${difference.detail}`);
  }
  if (report.differences.length > 20) {
    console.error(`\n… and ${report.differences.length - 20} more`);
  }
  return 1;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
