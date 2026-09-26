import { HomeLayout } from "fumadocs-ui/layouts/home";
import Link from "next/link";
import { baseOptions } from "@/lib/layout.shared";

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

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="landing">
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
              <Link className="button-primary" href="/docs/">
                Get started <span aria-hidden="true">↗</span>
              </Link>
              <Link className="button-secondary" href="/docs/guides/">
                Explore the guides <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="install-command">
              <span aria-hidden="true">$</span>
              <code>bun add @bloxwap/hyperliquid</code>
            </div>
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
              <span className="code-language">TS</span>
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
                <br /> transport: <span className="syntax-purple">new</span>{" "}
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
        <div className="feature-grid">
          {features.map((feature) => (
            <Link key={feature.number} href={feature.href} className="feature-card">
              <span className="feature-number">{feature.number}</span>
              <h2>
                {feature.title}
                <span aria-hidden="true">↗</span>
              </h2>
              <p>{feature.description}</p>
            </Link>
          ))}
        </div>
        <footer className="landing-footer">
          <span>Built by Bloxwap. Open source, MIT licensed.</span>
          <a href="https://github.com/bloxwap/hyperliquid">View on GitHub ↗</a>
        </footer>
      </main>
    </HomeLayout>
  );
}
