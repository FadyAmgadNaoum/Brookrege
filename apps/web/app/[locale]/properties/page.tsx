import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";
import Link from "next/link";
import { Suspense } from "react";
import { apiGet, toQuery, type Paged, type PropertyCard as Card, type Region } from "@/lib/api";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { FilterBar } from "@/components/FilterBar";
import { PropertyCard } from "@/components/PropertyCard";
import { Pagination } from "@/components/Pagination";
import { PageHero } from "@/components/PageHero";

type SP = Record<string, string | string[] | undefined>;
type Props = { params: { locale: string }; searchParams: SP };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");

const heading = (locale: Locale, sp: SP) => {
  const t = getDict(locale).list;
  return sp.transaction === "RENT" ? t.rentTitle : sp.transaction === "SALE" ? t.saleTitle : t.allTitle;
};

export function generateMetadata({ params, searchParams }: Props): Metadata {
  const locale = loc(params.locale);
  // Filtered and paged results are for visitors, not search engines: one indexable listing page per language.
  const filtered = Object.values(searchParams ?? {}).some((v) => v !== undefined && v !== "");
  return withAlternates(locale, "/properties", { title: heading(locale, searchParams), ...(filtered ? { robots: { index: false, follow: true } } : {}) });
}

export const dynamic = "force-dynamic";

export default async function PropertiesPage({ params, searchParams }: Props) {
  const locale = loc(params.locale);
  const t = getDict(locale);
  const [regions, result] = await Promise.all([
    apiGet<{ data: Region[] }>("/regions", 300),
    apiGet<Paged<Card>>(`/properties${toQuery(searchParams)}`),
  ]);

  return (
    <>
    <PageHero compact eyebrow={t.journey.eyebrow} title={heading(locale, searchParams)} still={searchParams?.transaction === "RENT" ? "bedroom" : "living"} />
    <div className="page -mt-10 relative z-10">
      <div className="rounded-card bg-surface p-5 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.35)] sm:p-7"><Suspense><FilterBar regions={regions.data} /></Suspense></div>

      <p className="mb-5 mt-10 text-sm text-silt-soft" aria-live="polite">{t.list.found(result.meta.total)}</p>

      {result.data.length ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {result.data.map((p, i) => (
            <li key={p.id} className="reveal" style={{ ["--d" as string]: i % 3 }}><PropertyCard p={p} locale={locale} /></li>
          ))}
        </ul>
      ) : (
        <div className="rounded-card bg-surface p-10">
          <p className="text-lg font-medium">{t.list.emptyTitle}</p>
          <p className="mt-2 text-silt-soft">
            {t.list.emptyBody} <Link href={`/${locale}/add-your-property`} className="link">{t.list.emptyLink}</Link> {t.list.emptyTail}
          </p>
        </div>
      )}
      <Pagination locale={locale} page={result.meta.page} pageCount={result.meta.pageCount} params={searchParams} />
    </div>
    </>
  );
}
