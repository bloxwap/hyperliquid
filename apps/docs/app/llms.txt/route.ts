import { llmsText } from "@/lib/agent";
import { agentPages } from "@/lib/agent-pages";

export const dynamic = "force-static";

export function GET() {
  return new Response(llmsText(agentPages()), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
