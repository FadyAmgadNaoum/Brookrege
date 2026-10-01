import type { Metadata } from "next";
import { LOCALES, type Locale } from "./i18n/config";

/**
 * The site's public address, for absolute links in the sitemap, canonical URLs and link previews.
 * SITE_URL wins (staging sets its own); otherwise the public API address, which is the same domain.
 */
export function siteUrl(): string {
  const raw = process.env.SITE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Staging and preview servers set SITE_INDEXING=off: robots.txt then blocks everything and pages say noindex. */
export const indexingAllowed = () => (process.env.SITE_INDEXING ?? "on").toLowerCase() !== "off";

const OG_LOCALE: Record<Locale, string> = { ar: "ar_EG", en: "en_US" };

/**
 * Canonical and language alternates for one page. `path` is the part after the locale ("" for the home page,
 * "/properties/abc"). Every page sets its own: alternates set in the layout would be inherited by every page
 * and point them all at the home page.
 */
export function pageAlternates(locale: Locale, path: string): Pick<Metadata, "alternates" | "openGraph"> {
  const languages = Object.fromEntries(LOCALES.map((l) => [l === "ar" ? "ar-EG" : "en", `/${l}${path}`]));
  return {
    alternates: { canonical: `/${locale}${path}`, languages: { ...languages, "x-default": `/ar${path}` } },
    openGraph: { url: `/${locale}${path}`, locale: OG_LOCALE[locale], alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]) },
  };
}

/** Merge page metadata with its alternates, keeping the page's own Open Graph fields (title, images). */
export function withAlternates(locale: Locale, path: string, meta: Metadata): Metadata {
  const alt = pageAlternates(locale, path);
  // Link previews show og:title/og:description, which Next.js doesn't copy from title/description.
  const text = {
    ...(typeof meta.title === "string" ? { title: meta.title } : {}),
    ...(meta.description ? { description: meta.description } : {}),
  };
  return { ...meta, alternates: alt.alternates, openGraph: { ...defaultOpenGraph(), ...alt.openGraph, ...text, ...(meta.openGraph ?? {}) } };
}

/** Shared Open Graph defaults; the image is apps/web/public/og.png (scripts/brand/build_icons.py). */
export function defaultOpenGraph(): NonNullable<Metadata["openGraph"]> {
  return { type: "website", siteName: "Brookrege", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Brookrege" }] };
}
