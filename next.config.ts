import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["camoufox-js", "impit", "playwright-core", "playwright", "pg", "neo4j-driver"],
};

export default nextConfig;
