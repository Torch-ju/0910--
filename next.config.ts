import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // The independent memory package uses NodeNext's .js specifiers in TypeScript sources.
  webpack(config) {
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default config;
