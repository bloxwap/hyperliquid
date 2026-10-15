import { describe, expect, test } from "bun:test";
import { remarkCallouts } from "./remark-callouts";

type Node = { type: string; value?: string; name?: string; attributes?: { value: string }[]; children?: Node[] };
const text = (value: string): Node => ({ type: "text", value });
const paragraph = (...children: Node[]): Node => ({ type: "paragraph", children });

function run(tree: Node): Node {
  remarkCallouts()(tree as never);
  return tree;
}

describe("remarkCallouts", () => {
  test("maps a GitHub alert with a separate marker paragraph", () => {
    const tree = run({
      type: "root",
      children: [{ type: "blockquote", children: [paragraph(text("[!WARNING]")), paragraph(text("Truncates."))] }],
    });
    const callout = tree.children?.[0];
    expect(callout?.type).toBe("mdxJsxFlowElement");
    expect(callout?.name).toBe("Callout");
    expect(callout?.attributes?.[0].value).toBe("warning");
    expect(callout?.children).toEqual([paragraph(text("Truncates."))]);
  });

  test("keeps text that shares the marker paragraph", () => {
    const tree = run({
      type: "root",
      children: [{ type: "blockquote", children: [paragraph(text("[!NOTE]\nBody"))] }],
    });
    expect(tree.children?.[0].children).toEqual([paragraph(text("Body"))]);
  });

  test("leaves ordinary and unknown blockquotes alone", () => {
    const quote = { type: "blockquote", children: [paragraph(text("[!DANGER] not a GitHub type"))] };
    const plain = { type: "blockquote", children: [paragraph(text("A quote"))] };
    const tree = run({ type: "root", children: structuredClone([quote, plain]) });
    expect(tree.children).toEqual([quote, plain]);
  });
});
