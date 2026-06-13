import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
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
};

export default nextConfig;
