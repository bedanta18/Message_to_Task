import type { NextConfig } from "next";

// The app is served at https://www.aipmbedanta.com/tools/agency-action-hub via a
// Vercel rewrite from the Astro site, so every route and asset lives under this basePath.
const nextConfig: NextConfig = {
  basePath: "/tools/agency-action-hub",
  poweredByHeader: false,
  // PGlite (embedded Postgres for local dev/tests) ships WASM; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // SQL migrations are read at runtime (auto-migrate on cold start).
  outputFileTracingIncludes: { "/**": ["./migrations/**"] },
  experimental: {
    // Requests arrive via the aipmbedanta.com rewrite, so the Origin differs from the
    // deployment host; allow the public site origin for Server Actions.
    serverActions: { allowedOrigins: ["www.aipmbedanta.com", "aipmbedanta.com"] },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
