import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getMDXComponents } from "../components/mdx";
import type { CalloutType } from "./remark-callouts";

const { Callout } = getMDXComponents();

describe("packaged documentation callout semantics", () => {
  const cases: [CalloutType, string, string][] = [
    ["note", "Note", "note"],
    ["tip", "Tip", "tip"],
    ["important", "Important", "info"],
    ["warning", "Warning", "warning"],
    ["caution", "Caution", "error"],
  ];
  for (const [type, title, severity] of cases) {
    test(`${type} keeps its title/body and uses the canonical ${severity} severity without a live region`, () => {
      const html = renderToStaticMarkup(
        <Callout type={type}>
          <p>
            Keep <code>0.000001</code> unchanged.
          </p>
        </Callout>,
      );
      expect(html).toContain(`data-type="${type}"`);
      expect(html).toContain(`data-severity="${severity}"`);
      expect(html).toContain(`<strong>${title}</strong>`);
      expect(html).toContain("<p>Keep <code>0.000001</code> unchanged.</p>");
      expect(html).not.toContain("role=");
      expect(html).not.toContain("aria-live=");
    });
  }
});
