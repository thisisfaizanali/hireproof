import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Next only reads .env from its own folder; the shared one lives at the repo root.
loadEnvConfig(path.resolve(__dirname, "../.."));

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The browser only talks to the web origin, so auth cookies set later are
  // first-party and keep working in Safari on phones.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
