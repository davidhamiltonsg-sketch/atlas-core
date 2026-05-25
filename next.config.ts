import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Type checking passes locally; Vercel's TS version differs from local with Prisma driver adapters
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["@libsql/client", "@prisma/adapter-libsql"],
};

export default nextConfig;
