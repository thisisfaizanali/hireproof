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

// Next inlines a few scripts and styles of its own, so those two directives
// allow 'unsafe-inline'. The CV viewer frames /api/cvs/:id/file from this origin.
// React needs eval in development only.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  agentRules: false,
  // Next only inlines NEXT_PUBLIC_ values from its own folder's .env files.
  env: {
    NEXT_PUBLIC_DEMO_LOGINS: process.env.NEXT_PUBLIC_DEMO_LOGINS ?? "",
    NEXT_PUBLIC_DEMO_PASSWORD: process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "",
  },
  // The API sets its own headers on /api, so these are for pages only.
  async headers() {
    return [
      {
        source: "/((?!api/).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  // The browser only talks to the web origin, so auth cookies set later are
  // first-party and keep working in Safari on phones.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
