import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";

/** Cloudflare Email Routing forwards it to staff (docs/operations/SUPPORT-EMAIL.md). */
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@brookrege.com";

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <footer className="mt-24 border-t border-reed">
      <div className="page flex flex-col gap-4 py-10 text-xs text-silt-soft sm:flex-row sm:items-center sm:justify-between">
        <p>{t.footer.tagline}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href={`/${locale}/add-your-property`} className="hover:text-silt">{t.footer.list}</Link>
          <Link href={`/${locale}/projects`} className="hover:text-silt">{t.footer.projects}</Link>
          <Link href={`/${locale}/privacy`} className="hover:text-silt">{t.footer.privacy}</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-silt" aria-label={`${t.footer.contact}: ${SUPPORT_EMAIL}`}><bdi dir="ltr">{SUPPORT_EMAIL}</bdi></a>
        </div>
      </div>
    </footer>
  );
}
