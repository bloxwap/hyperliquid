// GitHub alert blockquotes (`> [!NOTE]`) become `<Callout type>` so the Markdown source stays
// GitHub-compatible while the site renders HIG callouts. Only the five GitHub alert types are mapped.
type Node = { type: string; value?: string; children?: Node[]; [key: string]: unknown };

export const calloutTypes = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutType = (typeof calloutTypes)[number];

const marker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/;

function toCallout(node: Node): Node | null {
  const first = node.children?.[0];
  const text = first?.type === "paragraph" ? first.children?.[0] : undefined;
  const match = text?.type === "text" ? marker.exec(text.value ?? "") : null;
  if (!first || !text || !match) return null;
  // Keep any text that shares the marker's paragraph ("[!NOTE]\nText") as the callout's first paragraph.
  const remaining = (text.value ?? "").slice(match[0].length);
  const rest = (first.children ?? []).slice(1);
  const lead =
    remaining || rest.length > 0
      ? [{ ...first, children: remaining ? [{ ...text, value: remaining }, ...rest] : rest }]
      : [];
  return {
    type: "mdxJsxFlowElement",
    name: "Callout",
    attributes: [{ type: "mdxJsxAttribute", name: "type", value: match[1].toLowerCase() }],
    children: [...lead, ...(node.children ?? []).slice(1)],
  };
}

function walk(node: Node): void {
  if (!node.children) return;
  node.children = node.children.map((child) => (child.type === "blockquote" ? (toCallout(child) ?? child) : child));
  for (const child of node.children) walk(child);
}

export function remarkCallouts() {
  return (tree: Node) => walk(tree);
}
