import type { Locale } from "./config";
import { dictionaries } from "./index";

// Egyptian property sites use Western digits in Arabic text; keep numbers Latin in both languages.
const num = (n: number, max = 0) => n.toLocaleString("en-US", { maximumFractionDigits: max });

export function money(amount: number, locale: Locale): string {
  return `${num(Math.round(amount))} ${dictionaries[locale].common.currency}`;
}

/** 1850000 → "1.85 مليون ج.م" / "1.85M EGP"; 850000 → "850 ألف ج.م" / "850K EGP" */
export function moneyCompact(amount: number, locale: Locale): string {
  const c = dictionaries[locale].common;
  const [value, unit] =
    amount >= 1_000_000 ? [num(amount / 1_000_000, 2), c.million] : amount >= 1_000 ? [num(Math.round(amount / 1_000)), c.thousand] : [num(amount), ""];
  if (locale === "ar") return unit ? `${value} ${unit} ${c.currency}` : `${value} ${c.currency}`;
  return `${value}${unit} ${c.currency}`;
}

export const area = (sqm: number, locale: Locale) => `${num(sqm)} ${dictionaries[locale].common.sqm}`;

export const plain = (n: number) => num(n);

/** Pick the right language for content fields, falling back to whatever exists. */
export const titleOf = (p: { title: string; titleEn?: string | null }, locale: Locale) => (locale === "en" ? p.titleEn || p.title : p.title);
export const nameOf = (x: { name: string; nameAr?: string | null }, locale: Locale) => (locale === "ar" ? x.nameAr || x.name : x.name);
export const descOf = (p: { description: string | null; descriptionEn?: string | null }, locale: Locale) =>
  locale === "en" ? p.descriptionEn || p.description : p.description;
