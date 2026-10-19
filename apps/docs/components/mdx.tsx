import { type AlertSeverity, Callout as HIGCallout } from "@bloxwap/hig-react/status";
import defaultComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import type { CalloutType } from "@/lib/remark-callouts";

const callouts: Record<CalloutType, { title: string; severity: AlertSeverity }> = {
  note: { title: "Note", severity: "note" },
  tip: { title: "Tip", severity: "tip" },
  important: { title: "Important", severity: "info" },
  warning: { title: "Warning", severity: "warning" },
  caution: { title: "Caution", severity: "error" },
};

/** Static documentation callouts are not live regions, so they are not announced on page load. */
export function Callout({ type = "note", children }: { type?: CalloutType; children?: ReactNode }) {
  const { title, severity } = callouts[type] ?? callouts.note;
  return (
    <div className="docs-callout" data-type={type}>
      <HIGCallout title={title} severity={severity} announce={false}>
        {children}
      </HIGCallout>
    </div>
  );
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultComponents, Callout, ...components };
}
