import {
  NON_RESIDENTIAL_TYPES,
  RENTABLE_TYPES,
  type PropertyType,
  type SellerType,
  type TransactionType,
} from "./constants";

export interface ListingInput {
  type: PropertyType;
  transaction: TransactionType;
  sellerType?: SellerType | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  price: number;
  areaSqm: number;
}

export interface RuleViolation {
  field: keyof ListingInput;
  message: string;
}

/**
 * Business rules that a listing must satisfy regardless of who creates it.
 * Pure function: used by the API (authoritative) and the admin UI (instant feedback).
 */
export function validateListing(input: ListingInput): RuleViolation[] {
  const errors: RuleViolation[] = [];

  if (input.transaction === "RENT" && !RENTABLE_TYPES.includes(input.type)) {
    errors.push({ field: "type", message: "Only apartments and shops can be listed for rent." });
  }

  if (input.transaction === "SALE" && !input.sellerType) {
    errors.push({ field: "sellerType", message: "Choose developer or resale for properties for sale." });
  }

  if (input.transaction === "RENT" && input.sellerType) {
    errors.push({ field: "sellerType", message: "Seller type applies to properties for sale only." });
  }

  if (NON_RESIDENTIAL_TYPES.includes(input.type)) {
    if (input.type === "LAND" && (input.bedrooms || input.bathrooms)) {
      errors.push({ field: "bedrooms", message: "Land cannot have bedrooms or bathrooms." });
    }
  } else if (input.bedrooms == null) {
    errors.push({ field: "bedrooms", message: "Enter the number of bedrooms." });
  }

  if (!Number.isFinite(input.price) || input.price <= 0) {
    errors.push({ field: "price", message: "Price must be greater than zero." });
  }

  if (!Number.isInteger(input.areaSqm) || input.areaSqm <= 0) {
    errors.push({ field: "areaSqm", message: "Area must be a whole number of square meters." });
  }

  return errors;
}
