import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  poweredByHeader: false,
  typedRoutes: true,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
