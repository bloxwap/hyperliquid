import { createMDX } from "fumadocs-mdx/next";
import path from "node:path";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  images: { unoptimized: true },
  turbopack: { root: path.resolve(import.meta.dirname, "..") },
};

export default withMDX(config);
