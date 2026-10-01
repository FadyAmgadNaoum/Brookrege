import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";
import Link from "next/link";
import { apiGet, type CompoundSummary } from "@/lib/api";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { moneyCompact, nameOf } from "@/lib/i18n/format";
import { PageHero } from "@/components/PageHero";

type Props = { params: { locale: string } };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");

export function generateMetadata({ params }: Props): Metadata {
  const locale = loc(params.locale);
  return withAlternates(locale, "/compounds", { title: getDict(locale).compounds.title });
}

export const dynamic = "force-dynamic";

export default async function CompoundsPage({ params }: Props) {
  const locale = loc(params.locale);
  const t = getDict(locale);
  const c = t.compounds;
  const { data } = await apiGet<{ data: CompoundSummary[] }>("/compounds");
  return (
    <>
    <PageHero eyebrow={t.journey.eyebrow} title={c.title} still="facade"
      sub={<>{c.alsoBrowse} <Link href={`/${locale}/properties?location=out`}>{c.outside}</Link></>} />
    <div className="page pt-14">
      <ul className="grid gap-5 md:grid-cols-2">
        {data.map((x, i) => (
          <li key={x.id} className="reveal" style={{ ["--d" as string]: i % 2 }}>
            <Link href={`/${locale}/compounds/${x.slug}`} className="block rounded-card bg-surface p-8 transition-transform duration-700 ease-apple hover:scale-[1.01]">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-2xl font-semibold">{nameOf(x, locale)}</h2>
                <span className="text-sm text-silt-soft">{nameOf(x.region, locale)}</span>
              </div>
              {x.developerName && <p className="text-sm text-silt-soft">{c.by(x.developerName)}</p>}
              {x.types.length ? (
                <ul className="mt-6 space-y-2 text-sm">
                  {x.types.map((ty) => (
                    <li key={ty.type} className="flex justify-between gap-4">
                      <span>{t.types[ty.type]} <span className="text-silt-soft">{c.available(ty.availableUnits)}</span></span>
                      {ty.startingFrom != null && <span className="font-medium text-sandstone-dark">{c.from(moneyCompact(ty.startingFrom, locale))}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-6 text-sm text-silt-soft">{c.noUnits}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
    </>
  );
}
