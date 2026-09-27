import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/social";
import { source } from "@/lib/source";

export const dynamic = "force-static";

function entry(pageUrl: string, lastModified: Date, priority: number): MetadataRoute.Sitemap[number] {
  // Sitemap URLs describe the published site even when previewing without a base path.
  const path = pageUrl.replace(/^\/+|\/+$/g, "");
  return { url: new URL(path ? `${path}/` : "", siteUrl).href, lastModified, priority };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    entry("/", now, 1),
    ...source.getPages().map((page) => entry(page.url, now, page.url === "/docs" ? 0.9 : 0.7)),
    entry("/about/", now, 0.3),
    entry("/contact/", now, 0.3),
    entry("/privacy/", now, 0.3),
  ];
}
