import { ar, type Dict } from "./ar";
import { en } from "./en";
import type { Locale } from "./config";

export type { Dict };
export const dictionaries: Record<Locale, Dict> = { ar, en };
export const getDict = (locale: Locale): Dict => dictionaries[locale];
