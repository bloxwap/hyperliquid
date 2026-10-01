import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { baseOptions } from "@/lib/layout.shared";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()} className="min-h-dvh">
      <main className="landing prose trust-page">
        <h1>Page not found (404)</h1>
        <p>
          The page you requested does not exist on the Hyperliquid SDK documentation site. It may have moved, or the URL
          may be wrong.
        </p>
        <p>Start from one of these instead:</p>
        <ul>
          <li>
            <Link href="/docs/">Documentation</Link> — guides, clients, signing, transports, and API usage.
          </li>
          <li>
            <a href={`${basePath}/sitemap.xml`}>Sitemap</a> — every published page on this site.
          </li>
          <li>
            <a href={`${basePath}/llms.txt`}>llms.txt</a> — machine-readable site guide for AI agents, including
            Markdown versions of every page.
          </li>
        </ul>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
