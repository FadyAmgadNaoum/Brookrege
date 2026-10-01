import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";
import { apiGet } from "@/lib/api";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { PropertyMap, type Pin } from "@/components/PropertyMap";
import { PageHero } from "@/components/PageHero";

type Props = { params: { locale: string } };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");

export function generateMetadata({ params }: Props): Metadata {
  const locale = loc(params.locale);
  return withAlternates(locale, "/map", { title: getDict(locale).map.title });
}

export const dynamic = "force-dynamic";

export default async function MapPage({ params }: Props) {
  const t = getDict(loc(params.locale)).map;
  const { data } = await apiGet<{ data: Pin[] }>("/properties/map");
  return (
    <>
    <PageHero compact eyebrow={getDict(loc(params.locale)).journey.eyebrow} title={t.title} still="view" sub={t.count(data.length)} />
    <div className="page pt-10">
      <PropertyMap pins={data} />
    </div>
    </>
  );
}
