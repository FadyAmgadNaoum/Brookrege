import type { Prisma } from "@prisma/client";
import { PROPERTY_TYPES, SELLER_TYPES, TRANSACTION_TYPES } from "@brookrege/domain";
import { z } from "zod";

/** Filters from the brief: type, transaction, region, price, area — plus compound and seller type. */
export const listQueryBase = z.object({
    type: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
      .pipe(z.array(z.enum(PROPERTY_TYPES)).optional()),
    transaction: z.enum(TRANSACTION_TYPES).optional(),
    seller: z.enum(SELLER_TYPES).optional(),
    region: z.string().max(80).optional(),
    compound: z.string().max(80).optional(),
    /** "in" = inside any compound, "out" = outside compounds (client asked for both sections). */
    location: z.enum(["in", "out"]).optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    minArea: z.coerce.number().int().nonnegative().optional(),
    maxArea: z.coerce.number().int().nonnegative().optional(),
    bedrooms: z.coerce.number().int().min(0).max(20).optional(),
    q: z.string().trim().max(100).optional(),
    featured: z.enum(["true"]).optional(),
    sort: z.enum(["newest", "price_asc", "price_desc", "area_desc"]).default("newest"),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(12),
});

export const listQuerySchema = listQueryBase
  .refine((v) => v.minPrice == null || v.maxPrice == null || v.minPrice <= v.maxPrice, {
    message: "Minimum price is higher than maximum price.",
    path: ["minPrice"],
  })
  .refine((v) => v.minArea == null || v.maxArea == null || v.minArea <= v.maxArea, {
    message: "Minimum area is larger than maximum area.",
    path: ["minArea"],
  });

export type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * The one place that defines "publicly visible".
 * Expiry is enforced at read time as well as by the nightly job.
 */
export const publicVisibility = (now = new Date()): Prisma.PropertyWhereInput => ({
  status: "ACTIVE",
  deletedAt: null,
  expiresAt: { gt: now },
});

export function buildWhere(q: Partial<ListQuery>, base: Prisma.PropertyWhereInput): Prisma.PropertyWhereInput {
  const and: Prisma.PropertyWhereInput[] = [base];
  if (q.type?.length) and.push({ type: { in: q.type } });
  if (q.transaction) and.push({ transaction: q.transaction });
  if (q.seller) and.push({ sellerType: q.seller });
  if (q.region) and.push({ region: { slug: q.region } });
  if (q.compound) and.push({ compound: { slug: q.compound } });
  if (q.location === "in") and.push({ compoundId: { not: null } });
  if (q.location === "out") and.push({ compoundId: null });
  if (q.minPrice != null || q.maxPrice != null) and.push({ price: { gte: q.minPrice, lte: q.maxPrice } });
  if (q.minArea != null || q.maxArea != null) and.push({ areaSqm: { gte: q.minArea, lte: q.maxArea } });
  if (q.bedrooms != null) and.push({ bedrooms: { gte: q.bedrooms } });
  if (q.featured) and.push({ isFeatured: true });
  if (q.q)
    and.push({
      OR: [
        { title: { contains: q.q, mode: "insensitive" } },
        { titleEn: { contains: q.q, mode: "insensitive" } },
        { address: { contains: q.q, mode: "insensitive" } },
      ],
    });
  return { AND: and };
}

export const orderBy = (sort: ListQuery["sort"]): Prisma.PropertyOrderByWithRelationInput[] => {
  switch (sort) {
    case "price_asc":
      return [{ price: "asc" }, { id: "asc" }];
    case "price_desc":
      return [{ price: "desc" }, { id: "asc" }];
    case "area_desc":
      return [{ areaSqm: "desc" }, { id: "asc" }];
    default:
      return [{ isFeatured: "desc" }, { listedAt: "desc" }, { id: "asc" }];
  }
};

/** Photo/video payload: URL plus responsive sizes (srcset) and a video poster. */
export const mediaSelect = {
  url: true,
  alt: true,
  asset: { select: { kind: true, variants: true, posterUrl: true, status: true } },
} satisfies Prisma.PropertyMediaSelect;

/** Card payload — only what a listing card needs. */
export const cardSelect = {
  id: true,
  title: true,
  titleEn: true,
  type: true,
  transaction: true,
  sellerType: true,
  price: true,
  areaSqm: true,
  bedrooms: true,
  bathrooms: true,
  isFeatured: true,
  listedAt: true,
  region: { select: { name: true, nameAr: true, slug: true } },
  compound: { select: { name: true, nameAr: true, slug: true } },
  media: { select: mediaSelect, orderBy: [{ isCover: "desc" as const }, { sortOrder: "asc" as const }], take: 1 },
} satisfies Prisma.PropertySelect;
