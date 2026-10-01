import type { MetadataRoute } from "next";
import { apiGet } from "@/lib/api";
import { LOCALES } from "@/lib/i18n/config";
import { indexingAllowed, siteUrl } from "@/lib/site";

interface SitemapData { data: { properties: { id: string; updatedAt: string }[]; compounds: { slug: string; updatedAt: string }[] } }

// Rendered on request, so builds never need a running API. Cheap: the API answer is cached for an hour (and
// cleared on every admin change), and nginx's micro-cache absorbs crawler bursts.
export const dynamic = "force-dynamic";

const STATIC: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/properties", priority: 0.9, changeFrequency: "daily" },
  { path: "/compounds", priority: 0.7, changeFrequency: "weekly" },
  { path: "/projects", priority: 0.5, changeFrequency: "monthly" },
  { path: "/map", priority: 0.5, changeFrequency: "daily" },
  { path: "/add-your-property", priority: 0.4, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.1, changeFrequency: "monthly" },
];

/** One entry per page and language, each listing its other-language twin (hreflang). */
function entry(path: string, extra: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">): MetadataRoute.Sitemap {
  const base = siteUrl();
  const languages = { "ar-EG": `${base}/ar${path}`, en: `${base}/en${path}` };
  return LOCALES.map((l) => ({ url: `${base}/${l}${path}`, alternates: { languages }, ...extra }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingAllowed()) return [];
  const pages = STATIC.flatMap((s) => entry(s.path, { priority: s.priority, changeFrequency: s.changeFrequency }));
  let data: SitemapData["data"] = { properties: [], compounds: [] };
  try {
    data = (await apiGet<SitemapData>("/sitemap", 3600)).data;
  } catch {
    // API unreachable: still serve the fixed pages rather than an error (search engines retry later).
  }
  return [
    ...pages,
    ...data.compounds.flatMap((c) => entry(`/compounds/${c.slug}`, { lastModified: c.updatedAt, priority: 0.6, changeFrequency: "weekly" })),
    ...data.properties.flatMap((p) => entry(`/properties/${p.id}`, { lastModified: p.updatedAt, priority: 0.8, changeFrequency: "weekly" })),
  ];
}
