import Link from "next/link";
import type { TransactionType } from "@brookrege/domain";
import type { TypeSummary } from "@/lib/api";
import type { Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { moneyCompact } from "@/lib/i18n/format";

/** Property types with "starting from" price and available-unit count (client requirement). */
export function TypeIndex({ locale, items, transaction, extraQuery = "" }: { locale: Locale; items: TypeSummary[]; transaction: TransactionType; extraQuery?: string }) {
  const t = getDict(locale);
  if (!items.length) return <p className="text-sm text-silt-soft">{t.home.galleryEmpty}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => (
        <li key={it.type}>
          <Link href={`/${locale}/properties?transaction=${transaction}&type=${it.type}${extraQuery}`} className="flex items-baseline justify-between gap-4 rounded-tile border border-reed bg-surface px-5 py-4 transition-colors hover:border-palm">
            <span>
              <span className="block font-medium">{t.types[it.type]}</span>
              <span className="text-sm text-silt-soft">{t.units(it.availableUnits)}</span>
            </span>
            {it.startingFrom != null && (
              <span className="text-end">
                <span className="block text-xs text-silt-soft">{t.common.startingFrom}</span>
                <span className="font-semibold text-sandstone-dark">{moneyCompact(it.startingFrom, locale)}</span>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
