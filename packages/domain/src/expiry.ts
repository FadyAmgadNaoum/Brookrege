import { DEFAULT_LISTING_DURATION_MONTHS, type ListingStatus } from "./constants";

/**
 * Adds calendar months, clamping to the last day of the target month.
 * Jan 31 + 1 month => Feb 28/29 (never rolls into March).
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function computeExpiry(from: Date, months: number = DEFAULT_LISTING_DURATION_MONTHS): Date {
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new RangeError("Listing duration must be between 1 and 24 months.");
  }
  return addMonthsClamped(from, months);
}

export interface VisibilityInput {
  status: ListingStatus;
  expiresAt: Date | null;
  deletedAt: Date | null;
}

/**
 * The public site shows a listing only if it is ACTIVE and not past expiry.
 * The expiry check is applied at read time too, so a listing disappears
 * the moment it expires even if the nightly job has not run yet.
 */
export function isPubliclyVisible(p: VisibilityInput, now: Date = new Date()): boolean {
  if (p.deletedAt) return false;
  if (p.status !== "ACTIVE") return false;
  if (!p.expiresAt) return false;
  return p.expiresAt.getTime() > now.getTime();
}

export function daysUntilExpiry(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  return Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
}
