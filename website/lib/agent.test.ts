import { describe, expect, test } from "bun:test";
import {
  agentMarkdown,
  homeStructuredData,
  jsonLdScript,
  llmsFullText,
  llmsText,
  organization,
  pageUrl,
} from "./agent";

const site = "https://bloxwap.github.io/hyperliquid/";
const pages = [
  { url: "/docs/clients", title: "Clients", description: "Use the clients." },
  { url: "/docs", title: "Introduction" },
];

describe("pageUrl", () => {
  test("publishes routes under the project base path with a trailing slash", () => {
    expect(pageUrl("/")).toBe(site);
    expect(pageUrl("/docs")).toBe(`${site}docs/`);
    expect(pageUrl("/docs/guides/market-orders/")).toBe(`${site}docs/guides/market-orders/`);
  });
});

describe("llmsText", () => {
  const text = llmsText(pages);

  test("follows the llms.txt layout: H1, blockquote summary, then H2 sections", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Hyperliquid SDK (@bloxwap/hyperliquid)");
    expect(lines[2]?.startsWith("> ")).toBe(true);
    expect(text.match(/^# /gm)).toHaveLength(1);
    expect(text).toContain("\n## When to use this\n");
    expect(text).toContain("\n## How to call it\n");
    expect(text).toContain("\n## Docs\n");
    expect(text).toContain("\n## Optional\n");
  });

  test("links every docs page by its published URL, in a stable order", () => {
    const docs = text.split("\n## Docs\n\n")[1]?.split("\n\n")[0];
    expect(docs).toBe(`- [Introduction](${site}docs/)\n- [Clients](${site}docs/clients/): Use the clients.`);
  });

  test("points at the full text, sitemap, and company trust pages", () => {
    for (const url of [
      `${site}llms-full.txt`,
      `${site}sitemap.xml`,
      organization.about,
      organization.contact,
      organization.privacy,
    ]) {
      expect(text).toContain(`](${url})`);
    }
  });
});

describe("agentMarkdown", () => {
  test("drops front matter", () => {
    expect(agentMarkdown("---\ntitle: X\ndescription: Y\n---\n\n# X\n\nBody.\n", "clients.md")).toBe("# X\n\nBody.");
  });

  test("turns relative Markdown links into absolute website URLs", () => {
    const raw = [
      "[a](clients.md#info-endpoint)",
      "[b](guides/README.md)",
      "[c](../signing.md)",
      "[d](README.md)",
      "[e](https://example.com/x.md)",
      "[f](#local)",
    ].join("\n");
    expect(agentMarkdown(raw, "README.md").split("\n").slice(0, 2)).toEqual([
      `[a](${site}docs/clients/#info-endpoint)`,
      `[b](${site}docs/guides/)`,
    ]);
    expect(agentMarkdown(raw, "guides/market-orders.md").split("\n")).toEqual([
      `[a](${site}docs/guides/clients/#info-endpoint)`,
      `[b](${site}docs/guides/guides/)`,
      `[c](${site}docs/signing/)`,
      `[d](${site}docs/guides/)`,
      "[e](https://example.com/x.md)",
      "[f](#local)",
    ]);
  });
});

describe("llmsFullText", () => {
  test("concatenates every page with its source URL and links back to llms.txt", () => {
    const text = llmsFullText(pages.map((page) => ({ ...page, markdown: `# ${page.title}` })));
    expect(text).toContain(`${site}llms.txt`);
    expect(text).toContain(`<!-- Source: ${site}docs/clients/ -->\n\n# Clients`);
    expect(text).toContain(`<!-- Source: ${site}docs/ -->\n\n# Introduction`);
  });
});

describe("homeStructuredData", () => {
  const graph = homeStructuredData()["@graph"] as Record<string, unknown>[];
  const byType = (type: string) => graph.find((node) => node["@type"] === type);

  test("describes the SDK as free, MIT-licensed software published by the organization", () => {
    const software = byType("SoftwareApplication");
    expect(software).toMatchObject({
      name: "@bloxwap/hyperliquid",
      url: site,
      applicationCategory: "DeveloperApplication",
      license: "https://opensource.org/licenses/MIT",
      offers: { "@type": "Offer", price: "0" },
      publisher: { "@id": organization.id },
    });
    expect(software?.softwareVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("gives the organization a contact point and shares its @id with the root site", () => {
    expect(byType("Organization")).toMatchObject({
      "@id": "https://bloxwap.github.io/#organization",
      contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: organization.email }],
    });
  });

  test("serializes safely inside a script element", () => {
    expect(jsonLdScript({ a: "</script><script>" })).toBe('{"a":"\\u003c/script>\\u003cscript>"}');
    expect(JSON.parse(jsonLdScript(homeStructuredData()))).toEqual(homeStructuredData());
  });
});
