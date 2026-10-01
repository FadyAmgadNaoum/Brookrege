import type { Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { area } from "@/lib/i18n/format";

/** Area, bedrooms, bathrooms — the three fields the client asked for on every card. */
export function Specs({ locale, areaSqm, bedrooms, bathrooms }: { locale: Locale; areaSqm: number; bedrooms: number | null; bathrooms: number | null }) {
  const t = getDict(locale);
  const items = [area(areaSqm, locale), bedrooms != null ? t.bedrooms(bedrooms) : null, bathrooms != null ? t.bathrooms(bathrooms) : null].filter(Boolean) as string[];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-silt-soft">
      {items.map((i) => <li key={i}>{i}</li>)}
    </ul>
  );
}
