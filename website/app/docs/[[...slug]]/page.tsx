import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { source } from "@/lib/source";

type PageProps = { params: Promise<{ slug?: string[] }> };

function markdownHref(href: string | undefined): string | undefined {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href) || !/\.md(?:#|$)/.test(href)) return href;
  // Fumadocs resolves file links with ./ or ../; GitHub also accepts bare filenames.
  const path = href.replace(/(^|\/)README\.md(?=#|$)/, "$1index.md");
  return path.startsWith(".") ? path : `./${path}`;
}

export default async function Page({ params }: PageProps) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const MDX = page.data.body;
  const RelativeLink = createRelativeLink(source, page);
  const originalPath = page.path.replace(/(^|\/)index\.md$/, "$1README.md");

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: ({ href, ...props }) => <RelativeLink {...props} href={markdownHref(href)} />,
          })}
        />
      </DocsBody>
      <a className="edit-link" href={`https://github.com/bloxwap/hyperliquid/edit/main/docs/${originalPath}`}>
        Edit this page on GitHub <span aria-hidden="true">↗</span>
      </a>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
