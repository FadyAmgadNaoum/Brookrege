export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** Client requirement: Arabic (Egypt) first, English optional. */
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "bk-locale";
export const isLocale = (v: string): v is Locale => (LOCALES as readonly string[]).includes(v);
export const dirOf = (l: Locale) => (l === "ar" ? "rtl" : "ltr");
