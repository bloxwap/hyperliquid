import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import rehypeRaw from "rehype-raw";
import { remarkCallouts } from "./lib/remark-callouts";

export const docs = defineDocs({
  dir: "./content/docs",
  docs: { files: ["**/*.md", "!SUMMARY.md"] },
});

export default defineConfig({
  mdxOptions: {
    // GitHub alerts render as HIG callouts (components/mdx.tsx).
    remarkPlugins: [remarkCallouts],
    // Preserve native Markdown HTML and Fumadocs' generated MDX exports together.
    rehypePlugins: [
      [
        rehypeRaw,
        {
          passThrough: ["mdxjsEsm", "mdxFlowExpression", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxTextExpression"],
        },
      ],
    ],
  },
});
