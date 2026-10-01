import type { PropertyType, SellerType, TransactionType, Variants } from "@brookrege/domain";

const SERVER_BASE = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const BROWSER_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Place names: Latin `name` + optional `nameAr`. Written content: Arabic primary + optional `…En`. */
export interface Place { name: string; nameAr: string | null; slug: string }

export interface PropertyCard {
  id: string;
  title: string;
  titleEn: string | null;
  type: PropertyType;
  transaction: TransactionType;
  sellerType: SellerType | null;
  price: number;
  areaSqm: number;
  bedrooms: number | null;
  bathrooms: number | null;
  isFeatured: boolean;
  region: Place;
  compound: Place | null;
  media: Media[];
}
/** A listing photo or video. `asset` is null for Phase 1 uploads (single size). */
export interface Media { url: string; alt: string | null; asset: { kind: "IMAGE" | "VIDEO"; status: string; variants: Variants | null; posterUrl: string | null } | null }
export interface PropertyDetail extends PropertyCard {
  description: string | null;
  descriptionEn: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}
export interface TypeSummary { type: PropertyType; startingFrom: number | null; availableUnits: number }
export interface Region { id: string; name: string; nameAr: string | null; slug: string }
export interface CompoundSummary {
  id: string; name: string; nameAr: string | null; slug: string; developerName: string | null; coverImageUrl: string | null;
  region: Place; availableUnits: number; startingFrom: number | null; types: TypeSummary[];
}
export interface CompoundDetail {
  id: string; name: string; nameAr: string | null; slug: string; developerName: string | null;
  description: string | null; descriptionEn: string | null; coverImageUrl: string | null; region: Place;
}
export interface Project {
  id: string; kind: "PARTNERSHIP" | "COMPLETED"; name: string; nameAr: string | null;
  description: string | null; descriptionEn: string | null; partnerName: string | null;
  coverImageUrl: string | null; completedAt: string | null; region: { name: string; nameAr: string | null } | null;
}
export interface Paged<T> { data: T[]; meta: { total: number; page: number; pageSize: number; pageCount: number } }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Server-side GET with ISR caching. Returns null on 404 so pages can call notFound(). */
export async function apiGet<T>(path: string, revalidate = 30, opts: { noStore?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`${SERVER_BASE}/api${path}`, opts.noStore ? { cache: "no-store", headers: opts.headers } : { next: { revalidate }, headers: opts.headers });
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export async function apiGetOrNull<T>(path: string, revalidate = 30, opts: { noStore?: boolean; headers?: Record<string, string> } = {}): Promise<T | null> {
  try {
    return await apiGet<T>(path, revalidate, opts);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Forwards only known filter params to the API. */
const FILTER_KEYS = ["type", "transaction", "seller", "region", "compound", "location", "minPrice", "maxPrice", "minArea", "maxArea", "bedrooms", "q", "sort", "page"] as const;
export function toQuery(params: Record<string, string | string[] | undefined>, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = params[k];
    if (typeof v === "string" && v) qs.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}
