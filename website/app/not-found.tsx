import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { baseOptions } from "@/lib/layout.shared";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return (
    <HomeLayout {...baseOptions()}>
      <main className="landing">
        <div className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span /> 404 · PAGE NOT FOUND
            </p>
            <h1>This page does not exist.</h1>
            <p className="hero-description">
              The Hyperliquid SDK documentation has no page at this address. It may have moved. Start from the docs, or
              use the <a href={`${basePath}/sitemap.xml`}>sitemap</a> or <a href={`${basePath}/llms.txt`}>llms.txt</a>{" "}
              to find every page.
            </p>
            <div className="hero-actions">
              <Link className="button-primary" href="/docs/">
                Open the docs <ArrowRight size={16} aria-hidden />
              </Link>
              <Link className="button-secondary" href="/">
                Back to home <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </HomeLayout>
  );
}
