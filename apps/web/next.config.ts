import type { NextConfig } from "next";
import { applyEnvironmentAliases } from "@commons/database/environment-aliases";

// Vercel Marketplace names (Supabase, Postgres) fill Commons's names before the browser bundle is built, so NEXT_PUBLIC_* values are inlined.
applyEnvironmentAliases();

const nextConfig: NextConfig = {
  // Separate local qualification builds can coexist with the running preview.
  distDir: process.env.COMMONS_NEXT_DIST_DIR ?? ".next",
  trailingSlash: true,
  // Both city lookups read their bundled catalogs from disk at runtime.
  outputFileTracingIncludes: { "/api/v1/location-timezones": ["./lib/server/data/*"], "/api/v1/map-cities": ["./lib/server/data/*"] },
  images: { unoptimized: true },
  serverExternalPackages: ["xlsx"],
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
        },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }, {
      source: "/:entry(join|group-join|sign-in|account|auth)/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }, {
      source: "/new",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }];
  },
  transpilePackages: [
    "@commons/contracts",
    "@commons/database",
    "@commons/domain",
    "@commons/ui",
  ],
};

export default nextConfig;
