import { securityHeaders } from "../../packages/domain/securityHeaders.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@brookrege/domain"],
  poweredByHeader: false,
  // Type-checking and lint run as separate CI steps (npm run typecheck / lint).
  // Keeping them out of `next build` means a type nit can never block a deploy.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { outputFileTracingRoot: new URL("../../", import.meta.url).pathname },
  async headers() {
    // CSP and friends (packages/domain/securityHeaders.mjs); the admin must never be framed or indexed.
    const headers = securityHeaders({ apiUrl: process.env.NEXT_PUBLIC_API_URL, dev: process.env.NODE_ENV !== "production" });
    return [{ source: "/:path*", headers: [...headers, { key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};
export default nextConfig;
