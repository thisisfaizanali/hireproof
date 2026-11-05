import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Next only reads .env from its own folder; the shared one lives at the repo root.
// It has already loaded its own folder by now, so the reload must be forced.
loadEnvConfig(
  path.resolve(__dirname, "../.."),
  process.env.NODE_ENV !== "production",
  console,
  true,
);

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  agentRules: false,
  // Next only inlines NEXT_PUBLIC_ values from its own folder's .env files.
  env: {
    NEXT_PUBLIC_DEMO_LOGINS: process.env.NEXT_PUBLIC_DEMO_LOGINS ?? "",
    NEXT_PUBLIC_DEMO_PASSWORD: process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "",
  },
  // The browser only talks to the web origin, so auth cookies set later are
  // first-party and keep working in Safari on phones.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
