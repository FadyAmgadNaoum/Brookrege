import type { MetadataRoute } from "next";
import { indexingAllowed, siteUrl } from "@/lib/site";

// Read at request time, so one image serves production (indexed) and staging (SITE_INDEXING=off).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!indexingAllowed()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/healthz"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
