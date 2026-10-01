"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

/** Switches language on the SAME page, keeping filters in the URL. Remembers the choice. */
export function LocaleSwitch({ className = "" }: { className?: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const sp = useSearchParams();
  const other: Locale = locale === "ar" ? "en" : "ar";
  const rest = pathname.replace(/^\/(ar|en)(?=\/|$)/, "");
  const qs = sp.toString();
  const href = `/${other}${rest}${qs ? `?${qs}` : ""}`;

  return (
    <Link
      href={href}
      hrefLang={other}
      lang={other}
      aria-label={t.lang.otherAria}
      onClick={() => { document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=31536000; samesite=lax`; }}
      className={`inline-flex h-9 items-center rounded-full px-3 text-sm text-silt-soft transition-colors hover:bg-silt/5 hover:text-silt ${className}`}
    >
      {t.lang.other}
    </Link>
  );
}
