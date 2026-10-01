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
    // CSP and friends — see packages/domain/securityHeaders.mjs.
    return [
      { source: "/:path*", headers: securityHeaders({ apiUrl: process.env.NEXT_PUBLIC_API_URL, dev: process.env.NODE_ENV !== "production" }) },
      // The home film and its posters: versioned folders (journey/v1, v2 …), so they never change — cache for a year.
      { source: "/journey/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};
export default nextConfig;
