"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { TransactionType } from "@brookrege/domain";
import type { TypeSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { moneyCompact } from "@/lib/i18n/format";

/**
 * Apple-style horizontal gallery of property types, each with "starting from" price
 * and available units (client requirement). Snap scrolling; arrows respect RTL.
 */
export function TypeGallery({ sale, rent }: { sale: TypeSummary[]; rent: TypeSummary[] }) {
  const { locale, t } = useI18n();
  const [tx, setTx] = useState<TransactionType>("SALE");
  const track = useRef<HTMLUListElement>(null);
  const items = tx === "SALE" ? sale : rent;

  function scroll(direction: 1 | -1) {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: direction * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <section className="py-24 sm:py-32" aria-labelledby="gallery-h">
      <div className="page reveal flex flex-wrap items-end justify-between gap-6">
        <h2 id="gallery-h" className="headline text-silt">{t.home.galleryTitle}</h2>
        <div role="tablist" className="inline-grid grid-cols-2 rounded-full bg-surface p-1 text-sm">
          {(["SALE", "RENT"] as const).map((x) => (
            <button key={x} role="tab" aria-selected={tx === x} onClick={() => { setTx(x); track.current?.scrollTo({ left: 0 }); }}
              className={`rounded-full px-5 py-1.5 transition-colors duration-300 ${tx === x ? "bg-silt text-limestone" : "text-silt-soft hover:text-silt"}`}>
              {x === "SALE" ? t.home.gallerySale : t.home.galleryRent}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="page mt-10 text-silt-soft">{t.home.galleryEmpty}</p>
      ) : (
        <ul ref={track} key={tx} className="gallery mt-10 flex gap-5 overflow-x-auto px-5 pb-4 sm:px-[max(2rem,calc((100vw-72rem)/2+2rem))]">
          {items.map((it, i) => (
            <li key={it.type} className="reveal w-[78%] shrink-0 sm:w-[340px]" style={{ ["--d" as string]: i }}>
              <Link href={`/${locale}/properties?transaction=${tx}&type=${it.type}`}
                className="group flex h-[420px] flex-col justify-between rounded-card bg-surface p-8 transition-transform duration-700 ease-apple hover:scale-[1.015]">
                <div>
                  <p className="text-sm text-silt-soft">{tx === "SALE" ? t.home.gallerySale : t.home.galleryRent}</p>
                  <h3 className="serif mt-2 text-[2.2rem] leading-tight text-silt">{t.types[it.type]}</h3>
                </div>
                <svg viewBox="0 0 120 90" className="mx-auto h-28 text-palm/70 transition-transform duration-700 ease-apple group-hover:-translate-y-1" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M10 88V40a50 50 0 0 1 100 0v48" /><path d="M36 88V52a24 24 0 0 1 48 0v36" /><path d="M2 88h116" />
                </svg>
                <div>
                  {it.startingFrom != null && (
                    <p><span className="block text-sm text-silt-soft">{t.common.startingFrom}</span><span className="text-2xl font-semibold text-sandstone-dark">{moneyCompact(it.startingFrom, locale)}</span></p>
                  )}
                  <p className="mt-1 text-sm text-silt-soft">{t.units(it.availableUnits)}</p>
                  <p className="mt-4 text-sm font-medium text-palm group-hover:underline">{t.home.galleryBrowse(t.types[it.type])}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {items.length > 1 && (
        <div className="page mt-4 flex justify-end gap-2">
          <button onClick={() => scroll(-1)} aria-label={t.home.galleryPrev} className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-silt transition-colors hover:bg-reed">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="rtl:-scale-x-100"><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
          </button>
          <button onClick={() => scroll(1)} aria-label={t.home.galleryNext} className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-silt transition-colors hover:bg-reed">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="rtl:-scale-x-100"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
          </button>
        </div>
      )}
    </section>
  );
}
