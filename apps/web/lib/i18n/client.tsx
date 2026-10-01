"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./config";
import { dictionaries, type Dict } from "./index";

// Only the locale string crosses the server/client boundary; dictionaries contain
// functions (plural rules) so each side imports them directly.
const Ctx = createContext<Locale>("ar");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export function useI18n(): { locale: Locale; t: Dict } {
  const locale = useContext(Ctx);
  return { locale, t: dictionaries[locale] };
}
