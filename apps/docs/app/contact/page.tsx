import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { baseOptions } from "@/lib/layout.shared";
import { siteUrl } from "@/lib/social";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "How to contact the Bloxwap team about the Hyperliquid SDK: email support, GitHub issues, and community channels.",
  alternates: { canonical: new URL("contact/", siteUrl).href },
};

export default function ContactPage() {
  return (
    <HomeLayout {...baseOptions()} className="min-h-dvh">
      <main className="landing prose trust-page">
        <h1>Contact</h1>
        <p>
          The Hyperliquid SDK is maintained by Bloxwap, Inc. Choose the channel that matches what you need; the team
          reads all of them.
        </p>
        <h2>Support</h2>
        <p>
          Email <a href="mailto:support@bloxwap.com">support@bloxwap.com</a> for questions about the SDK, Bloxwap
          products, or anything that should not be discussed in public. Include the SDK version you are running and, if
          you are reporting a problem, a minimal reproduction.
        </p>
        <h2>Bug reports and feature requests</h2>
        <p>
          Open an issue on <a href="https://github.com/bloxwap/hyperliquid/issues">github.com/bloxwap/hyperliquid</a>.
          Issues are the fastest way to reach the maintainers for anything technical: unexpected API behavior, type
          errors, broken documentation links, or feature ideas.
        </p>
        <h2>Source code and contributions</h2>
        <p>
          The SDK and this documentation site are developed in public at{" "}
          <a href="https://github.com/bloxwap/hyperliquid">github.com/bloxwap/hyperliquid</a>. Pull requests are
          welcome; the repository README explains how to run the tests and documentation checks locally.
        </p>
        <h2>Community</h2>
        <p>
          Bloxwap also posts updates on <a href="https://x.com/bloxwap">X</a>,{" "}
          <a href="https://t.me/bloxwap">Telegram</a>, <a href="https://discord.com/invite/cEfkcg6JHT">Discord</a>, and{" "}
          <a href="https://www.reddit.com/r/Bloxwap/">Reddit</a>.
        </p>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
