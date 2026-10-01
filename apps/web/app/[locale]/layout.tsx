import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Amiri, IBM_Plex_Sans_Arabic, Marcellus } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeScript } from "@/components/ThemeScript";
import { RevealOnScroll } from "@/components/motion/RevealOnScroll";
import { LOCALES, dirOf, isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/client";
import { defaultOpenGraph, indexingAllowed, siteUrl } from "@/lib/site";
import "../globals.css";

// One family for Arabic and Latin, so both languages share one typographic voice.
// Only the weights the site uses (400/500/600): each extra weight is another font file per script (Phase 4).
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });
// Display faces for titles (one weight each): Marcellus for Latin capitals, Amiri for Arabic.
const marcellus = Marcellus({ subsets: ["latin"], weight: "400", variable: "--font-marcellus", display: "swap" });
const amiri = Amiri({ subsets: ["arabic"], weight: "400", variable: "--font-amiri", display: "swap" });

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  if (!isLocale(params.locale)) return {};
  const t = getDict(params.locale);
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t.meta.title, template: `%s | ${t.brand}` },
    description: t.meta.description,
    applicationName: t.brand,
    // Canonical and language alternates are set per page (lib/site.ts), never here: the layout's would apply to every page.
    openGraph: { ...defaultOpenGraph(), title: t.meta.title, description: t.meta.description, locale: params.locale === "ar" ? "ar_EG" : "en_US" },
    twitter: { card: "summary_large_image" },
    robots: indexingAllowed() ? { index: true, follow: true } : { index: false, follow: false },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F3EF" },
    { media: "(prefers-color-scheme: dark)", color: "#101513" },
  ],
};

export default function LocaleLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound();
  const locale: Locale = params.locale;
  const t = getDict(locale);
  return (
    // suppressHydrationWarning: ThemeScript adds the "dark"/"js" classes before React hydrates.
    <html lang={locale === "ar" ? "ar-EG" : "en"} dir={dirOf(locale)} className={`${plex.variable} ${marcellus.variable} ${amiri.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <LocaleProvider locale={locale}>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:m-3 focus:rounded focus:bg-surface focus:p-2">{t.skip}</a>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter locale={locale} />
          <RevealOnScroll />
        </LocaleProvider>
      </body>
    </html>
  );
}
