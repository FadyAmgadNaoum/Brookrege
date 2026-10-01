import Link from "next/link";
import { Suspense } from "react";
import { apiGet, type CompoundSummary, type Paged, type PropertyCard as Card, type Region, type TypeSummary } from "@/lib/api";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { moneyCompact, nameOf } from "@/lib/i18n/format";
import { FilterBar } from "@/components/FilterBar";
import { PropertyCard } from "@/components/PropertyCard";
import { CountUp } from "@/components/motion/CountUp";
import { Journey } from "@/components/home/Journey";
import { Statement } from "@/components/home/Statement";
import { TypeGallery } from "@/components/home/TypeGallery";
import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";

// Rendered per request so builds never depend on a running API.
export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  const locale = (isLocale(params.locale) ? params.locale : "ar") as Locale;
  const t = getDict(locale);
  return withAlternates(locale, "", { title: { absolute: t.meta.title }, description: t.meta.description, openGraph: { title: t.meta.title, description: t.meta.description } });
}

export default async function HomePage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : "ar") as Locale;
  const t = getDict(locale);
  const h = t.home;

  const [regions, sale, rent, compounds, latest] = await Promise.all([
    apiGet<{ data: Region[] }>("/regions", 300),
    apiGet<{ data: TypeSummary[] }>("/properties/summary?transaction=SALE"),
    apiGet<{ data: TypeSummary[] }>("/properties/summary?transaction=RENT"),
    apiGet<{ data: CompoundSummary[] }>("/compounds"),
    apiGet<Paged<Card>>("/properties?pageSize=6"),
  ]);
  const totalUnits = [...sale.data, ...rent.data].reduce((n, x) => n + x.availableUnits, 0);

  return (
    <>
      <Journey />
      <Statement />

      {/* Numbers */}
      <section className="page grid gap-10 py-24 text-center sm:grid-cols-3 sm:py-32">
        {[
          { value: totalUnits, label: h.statUnits },
          { value: compounds.data.length, label: h.statCompounds },
          { value: 3, label: h.statMonths },
        ].map((s, i) => (
          <div key={s.label} className="reveal" style={{ ["--d" as string]: i }}>
            <p className="text-[clamp(3.5rem,8vw,6rem)] font-semibold leading-none text-silt"><CountUp value={s.value} /></p>
            <p className="mt-3 text-silt-soft">{s.label}</p>
          </div>
        ))}
      </section>

      {/* Buy / rent two-up tiles */}
      <section className="page grid gap-5 md:grid-cols-2">
        {[
          { title: h.buyTitle, sub: h.buySub, cta: h.buyCta, href: `/${locale}/properties?transaction=SALE`, tone: "bg-surface" },
          { title: h.rentTitle, sub: h.rentSub, cta: h.rentCta, href: `/${locale}/properties?transaction=RENT`, tone: "bg-palm-tint" },
        ].map((x, i) => (
          <Link key={x.title} href={x.href} className={`reveal group relative flex min-h-[480px] flex-col overflow-hidden rounded-card p-10 text-center ${x.tone}`} style={{ ["--d" as string]: i }}>
            <h2 className="headline text-silt">{x.title}</h2>
            <p className="mx-auto mt-3 max-w-sm text-lg text-silt-soft">{x.sub}</p>
            <span className="pill-quiet mx-auto mt-4">{x.cta}</span>
            <svg viewBox="0 0 200 140" className="mx-auto mt-auto w-64 text-palm/60 transition-transform duration-1000 ease-apple group-hover:scale-105" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              {i === 0 ? (
                <><path d="M20 138V60l80-50 80 50v78" /><path d="M78 138V92h44v46" /><path d="M44 80h20v18H44zM136 80h20v18h-20z" /><path d="M4 138h192" /></>
              ) : (
                <><path d="M30 138V30h140v108" /><path d="M30 64h140M30 98h140" /><path d="M86 138v-26h28v26" /><path d="M4 138h192" /></>
              )}
            </svg>
          </Link>
        ))}
      </section>

      <TypeGallery sale={sale.data} rent={rent.data} />

      {/* Compounds */}
      {compounds.data.length > 0 && (
        <section className="bg-surface py-24 sm:py-32" aria-labelledby="cmp-h">
          <div className="page">
            <div className="reveal max-w-2xl">
              <h2 id="cmp-h" className="headline text-silt">{h.compoundsTitle}</h2>
              <p className="mt-3 text-lg text-silt-soft">{h.compoundsSub}</p>
            </div>
            <ul className="mt-12 grid gap-5 md:grid-cols-2">
              {compounds.data.slice(0, 4).map((c, i) => (
                <li key={c.id} className="reveal" style={{ ["--d" as string]: i }}>
                  <Link href={`/${locale}/compounds/${c.slug}`} className="group block rounded-card bg-limestone p-8 transition-transform duration-700 ease-apple hover:scale-[1.01]">
                    <p className="text-sm text-silt-soft">{nameOf(c.region, locale)}</p>
                    <h3 className="mt-1 text-3xl font-semibold text-silt">{nameOf(c, locale)}</h3>
                    <div className="mt-10 flex items-end justify-between gap-4">
                      <p className="text-silt-soft">{t.units(c.availableUnits)}</p>
                      {c.startingFrom != null && (
                        <p className="text-end"><span className="block text-xs text-silt-soft">{t.common.startingFrom}</span><span className="text-xl font-semibold text-sandstone-dark">{moneyCompact(c.startingFrom, locale)}</span></p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="reveal mt-8 flex flex-wrap gap-6">
              <Link href={`/${locale}/compounds`} className="link">{h.compoundsAll}</Link>
              <Link href={`/${locale}/properties?location=out`} className="link">{h.compoundsOutside}</Link>
            </div>
          </div>
        </section>
      )}

      {/* Search */}
      <section className="page py-24 sm:py-32" aria-labelledby="search-h">
        <div className="reveal mb-10 text-center">
          <h2 id="search-h" className="headline text-silt">{h.searchTitle}</h2>
          <p className="mt-3 text-lg text-silt-soft">{h.searchSub}</p>
        </div>
        <div className="reveal"><Suspense><FilterBar regions={regions.data} /></Suspense></div>
      </section>

      {/* Latest */}
      {latest.data.length > 0 && (
        <section className="page pb-24" aria-labelledby="new-h">
          <div className="reveal mb-8 flex items-baseline justify-between gap-4">
            <h2 id="new-h" className="headline text-silt">{h.latestTitle}</h2>
            <Link href={`/${locale}/properties`} className="link shrink-0">{h.latestAll}</Link>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {latest.data.map((p, i) => (
              <li key={p.id} className="reveal" style={{ ["--d" as string]: i % 3 }}><PropertyCard p={p} locale={locale} /></li>
            ))}
          </ul>
        </section>
      )}

      {/* Owner CTA */}
      <section className="page">
        <div className="reveal rounded-card bg-[#0b0f13] px-8 py-20 text-center text-white">
          <p className="mb-4 text-xs uppercase tracking-[0.32em] text-gold rtl:tracking-normal">{t.brand}</p>
          <h2 className="headline">{h.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-white/80">{h.ctaSub}</p>
          <Link href={`/${locale}/add-your-property`} className="btn-gold mt-8">{h.ctaButton}</Link>
        </div>
      </section>
    </>
  );
}
