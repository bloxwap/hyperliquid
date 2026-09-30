import { createSocialImage } from "@/lib/og-image";
import { homeDescription, socialImagePath } from "@/lib/social";
import { source } from "@/lib/source";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return ["/", ...source.getPages().map((page) => page.url)].map((url) => ({
    slug: socialImagePath(url).slice("/og/".length).split("/"),
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const path = `/og/${(await params).slug.join("/")}`;
  if (path === socialImagePath("/")) {
    return createSocialImage({
      title: "bloxwap/hyperliquid",
      description: homeDescription,
      category: "Docs",
      home: true,
    });
  }

  const page = source.getPages().find((page) => socialImagePath(page.url) === path);
  if (!page) return new Response("Not found", { status: 404 });

  return createSocialImage({
    title: page.data.title,
    description: page.data.description ?? homeDescription,
    category: page.url.startsWith("/docs/guides")
      ? "Guides"
      : page.url.startsWith("/docs/reference")
        ? "Reference"
        : "Docs",
  });
}
