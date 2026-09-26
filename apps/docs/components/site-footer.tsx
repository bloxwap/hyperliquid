import Image from "next/image";
import { BRAND_WORDMARK, BRAND_X } from "@/lib/brand";

// Mirrors the footer on bloxwap.com, with its on-site links made absolute.
const columns = [
  {
    title: "Product",
    links: [
      { label: "Home", href: "https://bloxwap.com" },
      { label: "Web", href: "https://bloxwap.app" },
      { label: "Pro", href: "https://bloxwap.pro" },
      { label: "App", href: "https://bloxwap.com/#app" },
    ],
  },
  {
    title: "Social",
    links: [
      { label: "X", href: "https://x.com/bloxwap" },
      { label: "Telegram", href: "https://t.me/bloxwap" },
      { label: "Discord", href: "https://discord.com/invite/cEfkcg6JHT" },
      { label: "Reddit", href: "https://www.reddit.com/r/Bloxwap/" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Blog", href: "https://bloxwap.com/blog" },
      { label: "Docs", href: "https://bloxwap.com/docs" },
      { label: "GitHub", href: "https://github.com/bloxwap" },
      { label: "Contact", href: "mailto:support@bloxwap.com" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <a className="footer-lockup" href="https://bloxwap.com" aria-label="Bloxwap home">
            <Image
              src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logos/bloxwap-icon-green.svg`}
              alt=""
              width={36}
              height={36}
            />
            {/* Cropped at the baseline like bloxwap.com; the "p" descender overflows the box. */}
            <svg
              className="footer-wordmark"
              viewBox={`0 -${BRAND_WORDMARK.baseline} ${BRAND_WORDMARK.width} 157`}
              aria-hidden="true"
            >
              <path className="wordmark-letters" d={BRAND_WORDMARK.letters} />
              <g transform={BRAND_WORDMARK.xTransform}>
                <g className="wordmark-x" fill="none" strokeWidth={BRAND_X.strokeWidth} strokeLinecap="round">
                  {BRAND_X.paths.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </g>
              </g>
            </svg>
          </a>
          <p>The easiest way to trade.</p>
        </div>
        {columns.map((column) => (
          <div key={column.title} className="footer-col">
            <h2>{column.title}</h2>
            {column.links.map((link) => (
              <a key={link.label} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="footer-base">
        <span>&copy; {new Date().getFullYear()} Bloxwap, Inc.</span>
        <nav className="footer-legal" aria-label="Legal">
          <a href="https://bloxwap.com/docs/terms">Terms</a>
          <span aria-hidden>&bull;</span>
          <a href="https://bloxwap.com/docs/privacy">Privacy</a>
        </nav>
      </div>
    </footer>
  );
}
