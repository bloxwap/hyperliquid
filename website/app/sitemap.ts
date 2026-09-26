import type { MetadataRoute } from "next";
import { pageUrl } from "@/lib/agent";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // Every page is rebuilt on each deploy, so the build time is each page's last modification.
  const lastModified = new Date();
  return ["/", ...source.getPages().map((page) => page.url)].map((url) => ({ url: pageUrl(url), lastModified }));
}
