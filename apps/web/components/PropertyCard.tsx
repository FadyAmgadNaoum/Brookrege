import Link from "next/link";
import { pickVariant, srcSet } from "@brookrege/domain";
import type { PropertyCard as Card } from "@/lib/api";
import type { Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { money, nameOf, titleOf } from "@/lib/i18n/format";
import { SellerBadge } from "./SellerBadge";
import { Specs } from "./Specs";

export function PropertyCard({ p, locale }: { p: Card; locale: Locale }) {
  const t = getDict(locale);
  const cover = p.media[0];
  const title = titleOf(p, locale);
  const place = [p.compound && nameOf(p.compound, locale), nameOf(p.region, locale)].filter(Boolean).join(locale === "ar" ? "، " : ", ");
  return (
    <Link href={`/${locale}/properties/${p.id}`} className="group block overflow-hidden rounded-card border border-reed bg-surface transition-[border-color,transform,box-shadow] duration-500 ease-apple hover:-translate-y-1 hover:border-gold hover:shadow-[0_24px_50px_-30px_rgb(0_0_0/0.45)]">
      <div className="aspect-[4/3] overflow-hidden bg-reed/40">
        {cover ? (
          <img
            src={pickVariant(cover.asset?.variants, 480) ?? cover.asset?.posterUrl ?? cover.url}
            srcSet={srcSet(cover.asset?.variants)}
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            alt={cover.alt ?? title} loading="lazy" decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 ease-apple group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-silt-soft">{t.common.noPhoto}</div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <SellerBadge t={t} transaction={p.transaction} sellerType={p.sellerType} />
        <h3 className="serif line-clamp-2 text-xl leading-snug text-silt">{title}</h3>
        <p className="text-sm text-silt-soft">{place}</p>
        <p className="text-lg font-semibold text-sandstone-dark">
          {money(p.price, locale)}
          {p.transaction === "RENT" && <span className="text-sm font-normal text-silt-soft"> {t.common.perMonth}</span>}
        </p>
        <Specs locale={locale} areaSqm={p.areaSqm} bedrooms={p.bedrooms} bathrooms={p.bathrooms} />
      </div>
    </Link>
  );
}
