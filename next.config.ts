import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
