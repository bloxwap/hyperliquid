// Machine-readable files for AI agents and crawlers: llms.txt, llms-full.txt, and homepage JSON-LD.
// GitHub Pages serves static files only, so everything here is rendered once at build time.
import sdkPackage from "../../../packages/hyperliquid/package.json";
import { homeDescription, siteUrl } from "./social";

export const origin = siteUrl.origin;
export const repository = "https://github.com/bloxwap/hyperliquid";
export const npmPackage = "https://www.npmjs.com/package/@bloxwap/hyperliquid";

/** Company facts shared with the bloxwap.github.io root site. Keep them true. */
export const organization = {
  id: "https://bloxwap.com/#organization",
  name: "Bloxwap, Inc.",
  url: "https://bloxwap.com",
  email: "support@bloxwap.com",
  sameAs: [
    "https://x.com/bloxwap",
    "https://github.com/bloxwap",
    "https://t.me/bloxwap",
    "https://discord.com/invite/cEfkcg6JHT",
    "https://www.reddit.com/r/Bloxwap/",
  ],
  about: new URL("about/", siteUrl).href,
  contact: new URL("contact/", siteUrl).href,
  privacy: new URL("privacy/", siteUrl).href,
};

export type AgentPage = { url: string; title: string; description?: string };

/** The published URL of a site path such as `/docs/clients/` or `llms.txt`. */
export function absoluteUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ""), siteUrl).href;
}

/** The published URL of a page route such as `/docs/clients`, with the site's trailing slash. */
export function pageUrl(url: string): string {
  const path = url.replace(/^\/+|\/+$/g, "");
  return absoluteUrl(path ? `${path}/` : "");
}

/** The llms.txt index (https://llmstxt.org): when to use the SDK, how to call it, and every docs page. */
export function llmsText(pages: AgentPage[]): string {
  const docs = [...pages]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((page) => `- [${page.title}](${pageUrl(page.url)})${page.description ? `: ${page.description}` : ""}`);

  return `# Hyperliquid SDK (@bloxwap/hyperliquid)

> ${homeDescription} \`@bloxwap/hyperliquid\` is an MIT-licensed, community-supported TypeScript client for the Hyperliquid exchange API, published on npm by Bloxwap, Inc.

It covers the whole public Hyperliquid API: the Info endpoint (market data and account state), the Exchange endpoint (signed trading and account actions), WebSocket subscriptions, and the Explorer endpoint. Requests and responses are fully typed and validated. It runs on Bun 1.3.3+, Node.js 22.12+, modern browsers, and React Native, on mainnet or testnet.

## When to use this

Use \`@bloxwap/hyperliquid\` when an agent or developer, working in TypeScript or JavaScript, needs to:

- Read Hyperliquid market data: mid prices, order books, candles, funding, asset metadata, and perp or spot contexts (\`InfoClient\`).
- Read a user's positions, open orders, fills, balances, vault equity, or portfolio history (\`InfoClient\`).
- Place, modify, or cancel orders; move funds; manage leverage, agent wallets, vaults, sub-accounts, or multi-sig accounts (\`ExchangeClient\`).
- Stream live prices, trades, order books, and account events over WebSocket with automatic reconnection and resubscription (\`SubscriptionClient\`).
- Look up blocks, transactions, and addresses (\`ExplorerClient\`).
- Sign Hyperliquid L1 and user-signed actions with a viem account, a browser wallet, or a raw private key (\`@bloxwap/hyperliquid/signing\`).
- Format prices and sizes to Hyperliquid's precision rules and map symbols to asset IDs (\`@bloxwap/hyperliquid/utils\`).

Do not use it for other exchanges, for languages other than TypeScript or JavaScript (use Hyperliquid's official Python SDK instead), or as a hosted trading service: it is a client library that runs in your code and never holds keys or funds for you.

## How to call it

Install with \`npm i @bloxwap/hyperliquid\` (or \`bun add\`, \`pnpm add\`, \`yarn add\`), then:

\`\`\`ts
import { HttpTransport, InfoClient } from "@bloxwap/hyperliquid";

const info = new InfoClient({ transport: new HttpTransport() });
const mids = await info.allMids(); // { BTC: "…", ETH: "…", … }
\`\`\`

Trading needs a wallet. Test with \`new HttpTransport({ isTestnet: true })\` before using a funded key:

\`\`\`ts
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const exchange = new ExchangeClient({ transport: new HttpTransport(), wallet: privateKeyToAccount("0x...") });
await exchange.order({
  orders: [{ a: 0, b: true, p: "50000", s: "0.01", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
});
\`\`\`

Every client method takes the Hyperliquid API's own request fields and returns its typed response. Errors are typed classes (\`ApiRequestError\`, \`HttpRequestError\`, \`WebSocketRequestError\`, \`ValidationError\`); see Error handling below.

## Docs

Every documentation page also has a Markdown mirror: append \`.md\` to its path without the trailing slash (for example, \`/hyperliquid/docs/clients/\` becomes \`/hyperliquid/docs/clients.md\`).

${docs.join("\n")}

## Optional

- [Full documentation as Markdown](${absoluteUrl("llms-full.txt")}): Every docs page above in one plain-text file.
- [Sitemap](${absoluteUrl("sitemap.xml")}): Every page on this site.
- [Source code](${repository}): MIT-licensed repository and issue tracker.
- [npm package](${npmPackage}): Current version ${sdkPackage.version}.
- [About Bloxwap](${organization.about}): The company that maintains the SDK.
- [Contact](${organization.contact}): ${organization.email}, GitHub issues, X, and Discord.
- [Privacy](${organization.privacy}): No cookies or analytics on this site.
`;
}

/**
 * Prepares a docs source file for agents: drops YAML front matter and turns relative Markdown links
 * (as written for GitHub, e.g. `../clients.md#info-endpoint`) into absolute website URLs.
 * `sourcePath` is the file's path inside `docs/`, such as `guides/README.md`.
 */
export function agentMarkdown(raw: string, sourcePath: string): string {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "");
  const base = new URL(`docs/${sourcePath}`, "https://docs.invalid/");
  return body
    .replace(/\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g, (match, href: string) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return match;
      const target = new URL(href, base);
      const page = target.pathname.replace(/(^|\/)README\.md$/i, "$1").replace(/\.md$/i, "/");
      return `](${absoluteUrl(page)}${target.hash})`;
    })
    .trim();
}

/** llms-full.txt: the llms.txt header followed by every docs page's Markdown. */
export function llmsFullText(pages: (AgentPage & { markdown: string })[]): string {
  const sections = pages.map((page) => `<!-- Source: ${pageUrl(page.url)} -->\n\n${page.markdown}`);
  return `# Hyperliquid SDK (@bloxwap/hyperliquid): full documentation

> ${homeDescription} The index of these pages, with guidance on when to use the SDK, is at ${absoluteUrl("llms.txt")}.

${sections.join("\n\n---\n\n")}
`;
}

/** Homepage JSON-LD: the SDK as a SoftwareApplication, published by the organization. */
export function homeStructuredData(): Record<string, unknown> {
  const home = siteUrl.href;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organization.id,
        name: organization.name,
        alternateName: "Bloxwap",
        url: organization.url,
        logo: absoluteUrl("logos/bloxwap-symbol.svg"),
        email: organization.email,
        sameAs: organization.sameAs,
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: organization.email,
          url: organization.contact,
          availableLanguage: "English",
        },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${home}#software`,
        name: sdkPackage.name,
        alternateName: "Bloxwap Hyperliquid SDK",
        description: homeDescription,
        url: home,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "API client library",
        operatingSystem: "Node.js, Bun, Web browser, React Native",
        programmingLanguage: "TypeScript",
        softwareVersion: sdkPackage.version,
        license: "https://opensource.org/licenses/MIT",
        codeRepository: repository,
        downloadUrl: npmPackage,
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": organization.id },
      },
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        name: "Hyperliquid SDK documentation",
        url: home,
        inLanguage: "en",
        publisher: { "@id": organization.id },
      },
    ],
  };
}

/** Serializes JSON-LD for a <script> element; `<` is escaped so content cannot close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
