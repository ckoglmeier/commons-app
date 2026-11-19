import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate local qualification builds can coexist with the running preview.
  distDir: process.env.COMMONS_NEXT_DIST_DIR ?? ".next",
  trailingSlash: true,
  // Both city lookups read their bundled catalogs from disk at runtime.
  outputFileTracingIncludes: { "/marketing-share/*": ["./public/brand/templates/*", "./public/brand/destinations/*", "./public/brand/fonts/*"], "/api/v1/location-timezones": ["./lib/server/data/*"], "/api/v1/map-cities": ["./lib/server/data/*"] },
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
    }, ...["/launch/:path*", "/launch-media/:path*"].map(source => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    }))];
  },
  transpilePackages: [
    "@commons/contracts",
    "@commons/database",
    "@commons/domain",
    "@commons/ui",
  ],
};

export default nextConfig;
