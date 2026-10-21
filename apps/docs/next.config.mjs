import { createMDX } from "fumadocs-mdx/next";
import path from "node:path";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  images: { unoptimized: true },
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  // `bun run build` type-checks with tsrs (`bun run typecheck`) before `next build`, so type errors still fail the
  // build; skipping Next's own TypeScript 5 pass avoids checking the same files twice.
  typescript: { ignoreBuildErrors: true },
};

export default withMDX(config);
