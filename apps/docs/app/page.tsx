import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowDown, ArrowRight } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { InstallCommand } from "@/components/install-command";
import { MarketPlayground } from "@/components/market-playground";
import { SiteFooter } from "@/components/site-footer";
import { baseOptions } from "@/lib/layout.shared";
import { siteUrl } from "@/lib/social";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://bloxwap.com/#organization",
      name: "Bloxwap, Inc.",
      url: "https://bloxwap.com",
      sameAs: [
        "https://github.com/bloxwap",
        "https://x.com/bloxwap",
        "https://t.me/bloxwap",
        "https://discord.com/invite/cEfkcg6JHT",
        "https://www.reddit.com/r/Bloxwap/",
      ],
      contactPoint: {
        "@type": "ContactPoint",
        email: "support@bloxwap.com",
        contactType: "customer support",
        url: "https://bloxwap.github.io/hyperliquid/contact/",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl.href}#website`,
      url: siteUrl.href,
      name: "Hyperliquid SDK · Bloxwap",
      publisher: { "@id": "https://bloxwap.com/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      name: "@bloxwap/hyperliquid",
      description:
        "A fast, fully typed TypeScript and JavaScript SDK for the Hyperliquid exchange API: market data, trading, signing, and real-time subscriptions over HTTP and WebSocket.",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Bun, Node.js, Browsers, React Native",
      url: siteUrl.href,
      downloadUrl: "https://www.npmjs.com/package/@bloxwap/hyperliquid",
      codeRepository: "https://github.com/bloxwap/hyperliquid",
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: { "@id": "https://bloxwap.com/#organization" },
    },
  ],
};

const features = [
  {
    number: "01",
    title: "Connect",
    description: "One transport. Every endpoint. Read market data over HTTP or WebSocket.",
    href: "/docs/transports/",
  },
  {
    number: "02",
    title: "Trade",
    description: "Place orders, manage accounts, and sign actions with your preferred wallet.",
    href: "/docs/clients/#exchange-endpoint",
  },
  {
    number: "03",
    title: "Subscribe",
    description: "Stream market and account updates with automatic reconnection.",
    href: "/docs/clients/#websocket-subscriptions",
  },
];

/** The hero snippet as plain text, for the copy button; the markup below renders the same code. */
const MARKET_DATA_SNIPPET = `import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";

// Connect to Hyperliquid
const client = new InfoClient({
  transport: new HttpTransport(),
});

// Read every market's mid price
const mids = await client.allMids();
`;

export default function Home() {
  return (
    // min-h-dvh lets .landing grow into the slack, keeping the footer at the bottom of a tall window.
    <HomeLayout {...baseOptions()} className="min-h-dvh">
      <main className="landing">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify of a static constant is the Next.js-documented way to emit ld+json verbatim. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <div className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span /> THE HYPERLIQUID TYPESCRIPT SDK
            </p>
            <h1>
              Build on
              <br />
              <span>Hyperliquid.</span>
            </h1>
            <p className="hero-description">
              From your first market query to a live trading system. A fast, fully typed SDK for TypeScript and
              JavaScript.
            </p>
            <div className="hero-actions">
              <a className="button-primary" href="#playground">
                Try the playground <ArrowDown size={16} aria-hidden />
              </a>
              <Link className="button-secondary" href="/docs/">
                Get started <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            <InstallCommand />
            <p className="runtime-note">Bun · Node.js · Browsers · React Native</p>
          </div>
          <div className="code-window">
            <div className="code-toolbar">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span>market-data.ts</span>
              <div className="code-actions">
                <span className="code-language">TS</span>
                <CopyButton text={MARKET_DATA_SNIPPET} label="Copy code" className="code-copy" />
              </div>
            </div>
            <pre>
              <code>
                <span className="syntax-purple">import</span> {"{ HttpTransport, InfoClient }"}
                <br />
                <span className="syntax-purple">from</span> <span className="syntax-green">"@bloxwap/hyperliquid"</span>
                ;<br />
                <br />
                <span className="syntax-muted">{"// Connect to Hyperliquid"}</span>
                <br />
                <span className="syntax-purple">const</span> client = <span className="syntax-purple">new</span>{" "}
                <span className="syntax-blue">InfoClient</span>({"{"}
                <br />
                {"  "}transport: <span className="syntax-purple">new</span>{" "}
                <span className="syntax-blue">HttpTransport</span>(),
                <br />
                {"}"});
                <br />
                <br />
                <span className="syntax-muted">{"// Read every market's mid price"}</span>
                <br />
                <span className="syntax-purple">const</span> mids = <span className="syntax-purple">await</span> client.
                <span className="syntax-blue">allMids</span>();
              </code>
            </pre>
            <div className="code-status">
              <span /> Typed from request to response
            </div>
          </div>
        </div>
        <section id="playground" className="playground-section" aria-labelledby="playground-title">
          <div className="section-intro">
            <p className="eyebrow">
              <span /> LIVE · HYPERLIQUID MAINNET
            </p>
            <h2 id="playground-title">Market data playground</h2>
            <p>Pick an asset and a feed to stream real market data over a WebSocket. The code updates as you go.</p>
          </div>
          <MarketPlayground />
        </section>
        <div className="feature-grid">
          {features.map((feature) => (
            <Link key={feature.number} href={feature.href} className="feature-card">
              <span className="feature-number">{feature.number}</span>
              <h2>
                {feature.title}
                <ArrowRight size={18} aria-hidden />
              </h2>
              <p>{feature.description}</p>
            </Link>
          ))}
        </div>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
