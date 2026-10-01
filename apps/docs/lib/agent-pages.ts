import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type AgentPage, agentMarkdown } from "./agent";
import { source } from "./source";

// Next runs route handlers from the docs workspace directory at build time.
const docsDir = resolve(process.cwd(), "content/docs");

export function agentPages(): AgentPage[] {
  return source
    .getPages()
    .map((page) => ({ url: page.url, title: page.data.title, description: page.data.description }));
}

/** Every docs page with its Markdown source, read from the same files GitHub renders. */
export async function agentPagesWithMarkdown(): Promise<(AgentPage & { markdown: string })[]> {
  return Promise.all(
    source.getPages().map(async (page) => {
      // Fumadocs sees README.md as index.md (see lib/source.ts); read the original file.
      const sourcePath = page.path.replace(/(^|\/)index\.md$/, "$1README.md");
      const raw = await readFile(resolve(docsDir, sourcePath), "utf8");
      return {
        url: page.url,
        title: page.data.title,
        description: page.data.description,
        markdown: agentMarkdown(raw, sourcePath),
      };
    }),
  );
}
