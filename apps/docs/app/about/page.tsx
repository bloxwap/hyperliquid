import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { baseOptions } from "@/lib/layout.shared";
import { siteUrl } from "@/lib/social";

export const metadata: Metadata = {
  title: "About",
  description:
    "About the Bloxwap Hyperliquid SDK: an open-source, fully typed TypeScript client for the Hyperliquid API, maintained by Bloxwap, Inc.",
  alternates: { canonical: new URL("about/", siteUrl).href },
};

export default function AboutPage() {
  return (
    <HomeLayout {...baseOptions()} className="min-h-dvh">
      <main className="landing prose trust-page">
        <h1>About the Hyperliquid SDK</h1>
        <p>
          The Hyperliquid SDK (<code>@bloxwap/hyperliquid</code>) is an open-source TypeScript and JavaScript client for
          the <a href="https://hyperliquid.xyz">Hyperliquid</a> exchange API. It covers market data, trading, account
          management, and real-time subscriptions over HTTP and WebSocket, with types from request to response. The SDK
          runs on Bun, Node.js, browsers, and React Native, and is published under the MIT license.
        </p>
        <p>
          The SDK is developed and maintained by <a href="https://bloxwap.com">Bloxwap, Inc.</a>, a company building
          open-source trading tools. Bloxwap publishes the package on{" "}
          <a href="https://www.npmjs.com/package/@bloxwap/hyperliquid">npm</a> and develops it in public on{" "}
          <a href="https://github.com/bloxwap/hyperliquid">GitHub</a>, where every release, test run, and documentation
          deployment is produced by CI.
        </p>
        <h2>This website</h2>
        <p>
          This site is the SDK's documentation. It is a static site generated from the Markdown sources in the{" "}
          <a href="https://github.com/bloxwap/hyperliquid/tree/main/apps/docs/content/docs">apps/docs/content/docs</a>{" "}
          directory of the repository and hosted on GitHub Pages. Corrections and improvements are welcome as pull
          requests.
        </p>
        <h2>Relationship to Hyperliquid</h2>
        <p>
          This SDK is a community client maintained by Bloxwap, Inc. It is not published by, endorsed by, or affiliated
          with Hyperliquid or the Hyperliquid Foundation. &ldquo;Hyperliquid&rdquo; refers to the public exchange API
          that the SDK connects to.
        </p>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
