"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PROPERTY_TYPES, RENTABLE_TYPES, type TransactionType } from "@brookrege/domain";
import type { Region } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { nameOf } from "@/lib/i18n/format";

/** Filters from the brief: type, transaction, region, price, area. State lives in the URL. */
export function FilterBar({ regions }: { regions: Region[] }) {
  const { locale, t } = useI18n();
  const f = t.filters;
  const router = useRouter();
  const sp = useSearchParams();
  const [transaction, setTransaction] = useState<TransactionType>((sp.get("transaction") as TransactionType) || "SALE");
  const types = transaction === "RENT" ? RENTABLE_TYPES : PROPERTY_TYPES;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const qs = new URLSearchParams({ transaction });
    for (const key of ["type", "region", "minPrice", "maxPrice", "minArea", "maxArea", "seller", "location"]) {
      const v = String(fd.get(key) ?? "").trim();
      if (v) qs.set(key, v);
    }
    router.push(`/${locale}/properties?${qs.toString()}`);
  }

  return (
    <form onSubmit={submit} className="rounded-[22px] border border-reed bg-surface p-4 sm:p-6" role="search" aria-label={f.aria}>
      <div role="radiogroup" aria-label={f.buyRent} className="relative mb-5 inline-grid grid-cols-2 rounded-full bg-limestone p-1 text-sm">
        <span aria-hidden="true" className="absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-silt transition-[inset-inline-start] duration-500 ease-apple" style={{ insetInlineStart: transaction === "SALE" ? 4 : "calc(50%)" }} />
        {(["SALE", "RENT"] as const).map((x) => (
          <button key={x} type="button" role="radio" aria-checked={transaction === x} onClick={() => setTransaction(x)} className={`relative z-10 rounded-full px-6 py-1.5 transition-colors duration-300 ${transaction === x ? "text-limestone" : "text-silt-soft hover:text-silt"}`}>
            {x === "SALE" ? f.buy : f.rent}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label htmlFor="f-type" className="label">{f.type}</label>
          <select id="f-type" name="type" defaultValue={sp.get("type") ?? ""} className="field">
            <option value="">{f.anyType}</option>
            {types.map((x) => <option key={x} value={x}>{t.types[x]}</option>)}
          </select>
        </div>
        <div className="lg:col-span-2">
          <label htmlFor="f-region" className="label">{f.region}</label>
          <select id="f-region" name="region" defaultValue={sp.get("region") ?? ""} className="field">
            <option value="">{f.allRegions}</option>
            {regions.map((r) => <option key={r.slug} value={r.slug}>{nameOf(r, locale)}</option>)}
          </select>
        </div>
        <div className="lg:col-span-2">
          <label htmlFor="f-location" className="label">{f.location}</label>
          <select id="f-location" name="location" defaultValue={sp.get("location") ?? ""} className="field">
            <option value="">{f.locAny}</option>
            <option value="in">{f.locIn}</option>
            <option value="out">{f.locOut}</option>
          </select>
        </div>
        <div><label htmlFor="f-minp" className="label">{f.minPrice}</label><input id="f-minp" name="minPrice" type="number" min={0} step={50000} inputMode="numeric" dir="ltr" defaultValue={sp.get("minPrice") ?? ""} className="field" /></div>
        <div><label htmlFor="f-maxp" className="label">{f.maxPrice}</label><input id="f-maxp" name="maxPrice" type="number" min={0} step={50000} inputMode="numeric" dir="ltr" defaultValue={sp.get("maxPrice") ?? ""} className="field" /></div>
        <div><label htmlFor="f-mina" className="label">{f.minArea}</label><input id="f-mina" name="minArea" type="number" min={0} inputMode="numeric" dir="ltr" defaultValue={sp.get("minArea") ?? ""} className="field" /></div>
        <div><label htmlFor="f-maxa" className="label">{f.maxArea}</label><input id="f-maxa" name="maxArea" type="number" min={0} inputMode="numeric" dir="ltr" defaultValue={sp.get("maxArea") ?? ""} className="field" /></div>
        {transaction === "SALE" ? (
          <div>
            <label htmlFor="f-seller" className="label">{f.seller}</label>
            <select id="f-seller" name="seller" defaultValue={sp.get("seller") ?? ""} className="field">
              <option value="">{f.sellerAny}</option>
              <option value="DEVELOPER">{f.developer}</option>
              <option value="RESALE">{f.resale}</option>
            </select>
          </div>
        ) : <div />}
        <div className="flex items-end"><button type="submit" className="btn-primary w-full">{f.submit}</button></div>
      </div>
    </form>
  );
}
