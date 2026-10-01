import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";
import { notFound } from "next/navigation";
import { apiGet, apiGetOrNull, type CompoundDetail, type Paged, type PropertyCard as Card, type TypeSummary } from "@/lib/api";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { descOf, nameOf } from "@/lib/i18n/format";
import { PropertyCard } from "@/components/PropertyCard";
import { TypeIndex } from "@/components/TypeIndex";
import { PageHero } from "@/components/PageHero";

type Props = { params: { locale: string; slug: string } };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");
const load = (slug: string) => apiGetOrNull<{ data: CompoundDetail }>(`/compounds/${encodeURIComponent(slug)}`, 60);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = loc(params.locale);
  const c = await load(params.slug);
  if (!c) return { title: getDict(locale).notFound.title, robots: { index: false } };
  return withAlternates(locale, `/compounds/${c.data.slug}`, {
    title: nameOf(c.data, locale),
    ...(c.data.coverImageUrl ? { openGraph: { images: [{ url: c.data.coverImageUrl }] } } : {}),
  });
}

export const dynamic = "force-dynamic";

export default async function CompoundPage({ params }: Props) {
  const locale = loc(params.locale);
  const t = getDict(locale);
  const res = await load(params.slug);
  if (!res) notFound();
  const c = res.data;
  const slug = encodeURIComponent(params.slug);
  const name = nameOf(c, locale);
  const [sale, rent, list] = await Promise.all([
    apiGet<{ data: TypeSummary[] }>(`/properties/summary?transaction=SALE&compound=${slug}`),
    apiGet<{ data: TypeSummary[] }>(`/properties/summary?transaction=RENT&compound=${slug}`),
    apiGet<Paged<Card>>(`/properties?compound=${slug}&pageSize=24`),
  ]);
  const description = descOf(c, locale);

  return (
    <>
    <PageHero eyebrow={t.compounds.title} title={name} image={c.coverImageUrl} still="facade"
      sub={[nameOf(c.region, locale), c.developerName && t.compounds.by(c.developerName)].filter(Boolean).join(locale === "ar" ? "، " : ", ")} />
    <div className="page pt-14">
      {description && <p className="reveal max-w-prose whitespace-pre-line text-lg leading-relaxed">{description}</p>}

      <section className="reveal mt-16">
        <h2 className="mb-5 text-2xl font-semibold">{t.compounds.saleIn(name)}</h2>
        <TypeIndex locale={locale} items={sale.data} transaction="SALE" extraQuery={`&compound=${slug}`} />
      </section>
      {rent.data.length > 0 && (
        <section className="reveal mt-12">
          <h2 className="mb-5 text-2xl font-semibold">{t.compounds.rentIn(name)}</h2>
          <TypeIndex locale={locale} items={rent.data} transaction="RENT" extraQuery={`&compound=${slug}`} />
        </section>
      )}
      {list.data.length > 0 && (
        <section className="mt-12">
          <h2 className="reveal mb-5 text-2xl font-semibold">{t.compounds.units}</h2>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.map((p, i) => <li key={p.id} className="reveal" style={{ ["--d" as string]: i % 3 }}><PropertyCard p={p} locale={locale} /></li>)}
          </ul>
        </section>
      )}
    </div>
    </>
  );
}
