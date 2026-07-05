import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      // Some saved blocks have http image URLs; next/image otherwise throws
      // "hostname not configured" and crashes the whole page. next/image
      // fetches + optimizes server-side, so the browser still gets https
      // (no mixed content).
      { protocol: "http", hostname: "**" },
    ],
    // Next 16 defaults images.qualities to [75]; whitelist 100 so the
    // text-dense screenshot thumbnails can render crisp instead of mushy.
    qualities: [75, 100],
  },
  experimental: {
    // Hold dynamic and static segments in the client router cache longer so
    // back/forward and modal-close navigations re-render from memory
    // instead of re-fetching. 30s/180s is the are.na-snappy default.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // Security headers applied to every route. The frame-ancestors / X-Frame-Options
  // pair is the key defence against the site being embedded or cloned in an
  // iframe (clickjacking). A strict script-src CSP is deliberately omitted for
  // now — it risks breaking the Three.js graph, Supabase, and Next's inline
  // bootstrap scripts, and warrants its own tested pass.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
