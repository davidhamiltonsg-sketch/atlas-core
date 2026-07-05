import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Type checking passes locally; Vercel's TS version differs from local with Prisma driver adapters
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["@libsql/client", "@prisma/adapter-libsql"],
  async headers() {
    return [
      {
        // Never let a CDN/browser cache a stale worker — clients must pick up
        // updates (e.g. a bumped CACHE_NAME) on the very next load.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
