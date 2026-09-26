import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="brand-lockup">
          <Image
            src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logos/bloxwap-wordmark-white.svg`}
            alt="Bloxwap"
            width={112}
            height={31}
            priority
          />
          <span className="brand-product">SDK</span>
        </span>
      ),
    },
    githubUrl: "https://github.com/bloxwap/hyperliquid",
    themeSwitch: { enabled: false },
  };
}
