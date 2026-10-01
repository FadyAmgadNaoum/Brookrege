import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";

export function Pagination({ locale, page, pageCount, params }: { locale: Locale; page: number; pageCount: number; params: Record<string, string | string[] | undefined> }) {
  if (pageCount <= 1) return null;
  const t = getDict(locale).pagination;
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== "page") qs.set(k, v);
    qs.set("page", String(p));
    return `?${qs.toString()}`;
  };
  return (
    <nav aria-label={t.aria} className="mt-10 flex items-center justify-between text-sm">
      {page > 1 ? <Link href={href(page - 1)} className="btn-quiet rounded-full">{t.prev}</Link> : <span />}
      <span className="text-silt-soft">{t.pageOf(page, pageCount)}</span>
      {page < pageCount ? <Link href={href(page + 1)} className="btn-quiet rounded-full">{t.next}</Link> : <span />}
    </nav>
  );
}
