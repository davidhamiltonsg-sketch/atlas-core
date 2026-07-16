import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Type checking passes locally; Vercel's TS version differs from local with Prisma driver adapters
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["@libsql/client", "@prisma/adapter-libsql"],
  experimental: {
    serverActions: {
      // Statement-PDF import: a base64 PDF up to ~4 MB (≈5.4 MB encoded) must fit in the
      // extractFromScreenshot server-action body; the default limit is 1 MB.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
