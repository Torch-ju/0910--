import type { NextConfig } from "next";
const config: NextConfig = {
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: "http://127.0.0.1:8001/api/v1/:path*" }];
  },
};
export default config;
