import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        // Everything except the «Sul sito» iframe (/embed/*): its
        // frame-ancestors come from the site's registered origins (proxy.ts).
        source: "/:path((?!embed(?:/|$)).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Approval screens must not be embedded in another site's UI.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          // Review links are bearer credentials, including on error responses.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      // The review script on clients' sites: short cache, loadable with SRI (crossorigin).
      ...["/heili-review.js", "/heili-review.v1.js"].map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      })),
      {
        source: "/api/site/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        source: "/review/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/api/automation/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        source: "/api/review/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
