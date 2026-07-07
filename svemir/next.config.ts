import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    // Do NOT use Vercel's metered Image Optimization service (5k transforms/mo
    // on the free tier). We optimize uploaded screenshots ourselves at upload
    // time (see lib/upload-image.ts), and external OG images are already small.
    // next/image is kept for its lazy-loading and layout stability.
    unoptimized: true,
    remotePatterns: [
      // Still needed so next/image will render arbitrary remote hosts.
      { protocol: "https", hostname: "**" },
      // Legacy blocks with http image URLs. The CSP below adds
      // upgrade-insecure-requests so the browser fetches them over https
      // (no mixed content) now that Vercel no longer proxies them.
      { protocol: "http", hostname: "**" },
    ],
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
            // upgrade-insecure-requests: auto-upgrade any http image URL to
            // https so legacy blocks don't break as mixed content now that
            // next/image serves them directly (unoptimized) instead of via
            // Vercel's optimizer.
            value: "frame-ancestors 'none'; upgrade-insecure-requests",
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
