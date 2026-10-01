/**
 * Single source of truth for listing vocabulary.
 * Keep in sync with the Prisma enums in apps/api/prisma/schema.prisma.
 */
export const PROPERTY_TYPES = [
  "APARTMENT",
  "VILLA",
  "TOWNHOUSE",
  "STUDIO",
  "SHOP",
  "ADMINISTRATIVE",
  "LAND",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const TRANSACTION_TYPES = ["SALE", "RENT"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Client requirement: "For Sale - Developer" vs "For Sale - Resale". */
export const SELLER_TYPES = ["DEVELOPER", "RESALE"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export const LISTING_STATUSES = ["DRAFT", "ACTIVE", "EXPIRED", "SOLD", "ARCHIVED"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Client requirement: rentals are apartments and shops only. */
export const RENTABLE_TYPES: readonly PropertyType[] = ["APARTMENT", "SHOP"];

/** Types that have no bedrooms/bathrooms. */
export const NON_RESIDENTIAL_TYPES: readonly PropertyType[] = ["SHOP", "ADMINISTRATIVE", "LAND"];

/** Client requirement: listings auto-expire after 3 months. Overridable via settings. */
export const DEFAULT_LISTING_DURATION_MONTHS = 3;

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  APARTMENT: "Apartments",
  VILLA: "Villas",
  TOWNHOUSE: "Townhouses",
  STUDIO: "Studios",
  SHOP: "Shops",
  ADMINISTRATIVE: "Offices",
  LAND: "Land",
};

export const SELLER_TYPE_LABELS: Record<SellerType, string> = {
  DEVELOPER: "For sale – developer",
  RESALE: "For sale – resale",
};
