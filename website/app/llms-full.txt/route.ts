import { llmsFullText } from "@/lib/agent";
import { agentPagesWithMarkdown } from "@/lib/agent-pages";

export const dynamic = "force-static";

export async function GET() {
  return new Response(llmsFullText(await agentPagesWithMarkdown()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
