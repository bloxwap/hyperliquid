import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { baseOptions } from "@/lib/layout.shared";
import { siteUrl } from "@/lib/social";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Privacy policy for the Hyperliquid SDK documentation site: no analytics, no cookies, and no data collection by this site.",
  alternates: { canonical: new URL("privacy/", siteUrl).href },
};

export default function PrivacyPage() {
  return (
    <HomeLayout {...baseOptions()} className="min-h-dvh">
      <main className="landing prose trust-page">
        <h1>Privacy</h1>
        <p>
          This page describes how the Hyperliquid SDK documentation site at{" "}
          <a href="https://bloxwap.github.io/hyperliquid/">bloxwap.github.io/hyperliquid</a> handles your information.
        </p>
        <h2>What this site collects</h2>
        <p>
          Nothing directly. This documentation is a static website: it sets no cookies, runs no analytics or tracking
          scripts, embeds no third-party pixels, and keeps no logs of its own. Fonts and assets are served from the same
          origin, so browsing the documentation does not contact any other service on Bloxwap's behalf.
        </p>
        <h2>Hosting provider</h2>
        <p>
          The site is hosted on GitHub Pages. When you request a page, GitHub processes the connection and may log
          technical details such as your IP address, as described in the{" "}
          <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">
            GitHub General Privacy Statement
          </a>
          . Bloxwap does not receive those logs.
        </p>
        <h2>The SDK itself</h2>
        <p>
          When you run <code>@bloxwap/hyperliquid</code> in your own software, it speaks only to the Hyperliquid API
          endpoints you configure. It contains no telemetry and reports nothing to Bloxwap.
        </p>
        <h2>Bloxwap products</h2>
        <p>
          Bloxwap's products and main website are covered by the{" "}
          <a href="https://bloxwap.com/docs/privacy">Bloxwap privacy policy</a>. Questions about privacy can be sent to{" "}
          <a href="mailto:support@bloxwap.com">support@bloxwap.com</a>.
        </p>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
