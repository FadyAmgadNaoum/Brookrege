import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pickVariant, srcSet } from "@brookrege/domain";
import { apiGetOrNull, type Media, type PropertyDetail } from "@/lib/api";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { descOf, money, nameOf, titleOf } from "@/lib/i18n/format";
import { SellerBadge } from "@/components/SellerBadge";
import { Specs } from "@/components/Specs";
import { InquiryForm } from "@/components/InquiryForm";
import { ViewBeacon } from "@/components/ViewBeacon";
import { siteUrl, withAlternates } from "@/lib/site";

type Props = { params: { locale: string; id: string } };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");

/**
 * Cached for 30 s (ISR) — views are counted by <ViewBeacon> in the visitor's browser, so the page itself
 * can be cached (Phase 4 performance). Next.js de-duplicates this call between metadata and page.
 */
async function load(id: string) {
  return (await apiGetOrNull<{ data: PropertyDetail }>(`/properties/${encodeURIComponent(id)}`, 30))?.data ?? null;
}

/** The first photo (or a video's poster) at a size link previews accept. */
function coverImage(p: PropertyDetail): string | undefined {
  const m = p.media[0];
  if (!m) return undefined;
  if (m.asset?.kind === "VIDEO") return m.asset.posterUrl ?? undefined;
  return pickVariant(m.asset?.variants, 960) ?? m.url;
}

/** schema.org description of the listing, so search engines can show the price and photo. */
function structuredData(p: PropertyDetail, locale: Locale) {
  const url = `${siteUrl()}/${locale}/properties/${p.id}`;
  const abs = (u: string) => (u.startsWith("http") ? u : `${siteUrl()}${u}`);
  const images = p.media.filter((m) => m.asset?.kind !== "VIDEO").slice(0, 5).map((m) => abs(pickVariant(m.asset?.variants, 960) ?? m.url));
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: titleOf(p, locale),
    url,
    ...(images.length ? { image: images } : {}),
    ...(descOf(p, locale) ? { description: descOf(p, locale)!.slice(0, 500) } : {}),
    offers: { "@type": "Offer", price: p.price, priceCurrency: "EGP", businessFunction: p.transaction === "RENT" ? "http://purl.org/goodrelations/v1#LeaseOut" : "http://purl.org/goodrelations/v1#Sell" },
    contentLocation: { "@type": "Place", name: nameOf(p.region, locale), address: { "@type": "PostalAddress", addressLocality: nameOf(p.region, locale), addressRegion: locale === "ar" ? "سوهاج" : "Sohag", addressCountry: "EG" } },
  };
}

/** Photo with responsive sizes, or a video with its poster frame. The big one is the page's largest element (LCP): loaded first, at high priority. */
function MediaView({ m, alt, big }: { m: Media; alt: string; big?: boolean }) {
  if (m.asset?.kind === "VIDEO") {
    return <video src={m.url} poster={m.asset.posterUrl ?? undefined} controls preload="metadata" playsInline className={`${big ? "aspect-[16/10]" : "aspect-[4/3]"} w-full bg-black object-contain`} />;
  }
  return (
    <img
      src={pickVariant(m.asset?.variants, big ? 960 : 480) ?? m.url}
      srcSet={srcSet(m.asset?.variants)}
      sizes={big ? "(min-width: 1024px) 66vw, 100vw" : "25vw"}
      alt={m.alt ?? alt} loading={big ? "eager" : "lazy"} decoding={big ? "sync" : "async"}
      {...(big ? { fetchpriority: "high" } : {})}
      className={`${big ? "aspect-[16/10]" : "aspect-[4/3] rounded-xl"} w-full object-cover`}
    />
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = loc(params.locale);
  const t = getDict(locale);
  const p = await load(params.id);
  if (!p) return { title: t.detail.notFoundTitle, robots: { index: false } };
  const image = coverImage(p);
  return withAlternates(locale, `/properties/${p.id}`, {
    title: titleOf(p, locale),
    description: `${t.types[p.type]} — ${nameOf(p.region, locale)} — ${money(p.price, locale)}`,
    ...(image ? { openGraph: { images: [{ url: image, alt: titleOf(p, locale) }] } } : {}),
  });
}

export const revalidate = 30;

export default async function PropertyPage({ params }: Props) {
  const locale = loc(params.locale);
  const t = getDict(locale);
  const p = await load(params.id);
  if (!p) notFound();
  const title = titleOf(p, locale);
  const description = descOf(p, locale);
  const wa = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const [cover, ...rest] = p.media;
  const sep = locale === "ar" ? "، " : ", ";

  return (
    <div className="page pt-8">
      <ViewBeacon id={p.id} />
      {/* Data block for search engines (not executed; "<" escaped so text can't close the tag). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(p, locale)).replace(/</g, "\\u003c") }} />
      <nav aria-label={t.detail.breadcrumb} className="mb-6 text-sm text-silt-soft">
        <Link href={`/${locale}/properties?transaction=${p.transaction}`} className="hover:text-silt">{p.transaction === "RENT" ? t.detail.forRent : t.detail.forSale}</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/${locale}/properties?transaction=${p.transaction}&type=${p.type}`} className="hover:text-silt">{t.types[p.type]}</Link>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <article>
          <div className="intro overflow-hidden rounded-card bg-reed/40">
            {cover ? <MediaView m={cover} alt={title} big /> : <div className="flex aspect-[16/10] items-center justify-center text-sm text-silt-soft">{t.common.photosSoon}</div>}
          </div>
          {rest.length > 0 && (
            <ul className="mt-3 grid grid-cols-4 gap-3">
              {rest.slice(0, 8).map((m) => <li key={m.url} className="overflow-hidden rounded-xl"><MediaView m={m} alt="" /></li>)}
            </ul>
          )}

          <div className="mt-8 space-y-3">
            <SellerBadge t={t} transaction={p.transaction} sellerType={p.sellerType} />
            <h1 className="serif text-4xl leading-tight text-silt sm:text-5xl">{title}</h1>
            <p className="text-silt-soft">{[p.compound && nameOf(p.compound, locale), nameOf(p.region, locale)].filter(Boolean).join(sep)}</p>
            <p className="text-3xl font-semibold text-sandstone-dark">
              {money(p.price, locale)}
              {p.transaction === "RENT" && <span className="text-base font-normal text-silt-soft"> {t.common.perMonth}</span>}
            </p>
            <Specs locale={locale} areaSqm={p.areaSqm} bedrooms={p.bedrooms} bathrooms={p.bathrooms} />
          </div>

          {description && (
            <section className="mt-10 max-w-prose">
              <h2 className="kicker mb-4">{t.detail.about}</h2>
              <p className="whitespace-pre-line text-silt">{description}</p>
            </section>
          )}
          {p.latitude != null && p.longitude != null && (
            <p className="mt-6 text-sm">
              <a className="link" href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`} target="_blank" rel="noopener noreferrer">{t.detail.openMap}</a>
            </p>
          )}
        </article>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-card border-t-2 border-gold bg-surface p-6 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.3)]">
            <h2 className="serif mb-1 text-2xl">{t.detail.interested}</h2>
            <p className="mb-5 text-sm text-silt-soft">{t.detail.leaveNumber}</p>
            <InquiryForm propertyId={p.id} />
            {wa && (
              <a href={`https://wa.me/${wa}?text=${encodeURIComponent(t.detail.whatsappText(title))}`} target="_blank" rel="noopener noreferrer" className="btn-quiet mt-3 w-full rounded-full">
                {t.detail.whatsapp}
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
