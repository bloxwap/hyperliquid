import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import rehypeRaw from "rehype-raw";

export const docs = defineDocs({
  dir: "../docs",
  docs: { files: ["**/*.md", "!SUMMARY.md"] },
});

export default defineConfig({
  mdxOptions: {
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
