import type { Locale } from "./i18n/config";

const VIEWING_TEXT: Record<Locale, string> = {
  ar: "مرحبًا، أود حجز معاينة خاصة لعقار مع Brookrege.",
  en: "Hello, I'd like to book a private viewing with Brookrege.",
};

/** "Book a viewing": WhatsApp with a ready message when a number is configured, otherwise the listings. */
export function viewingHref(locale: Locale): string {
  const n = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(VIEWING_TEXT[locale])}` : `/${locale}/properties`;
}
