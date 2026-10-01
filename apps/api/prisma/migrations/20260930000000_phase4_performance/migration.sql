-- Phase 4 · Week 14: indexes for the public listing pages, search and analytics.
-- Measured on 40,000 listings / 60,000 inquiries / 400,000 view rows: docs/operations/PERFORMANCE.md.
--
-- Partial indexes (WHERE ...) and trigram indexes can't be written in schema.prisma. If `prisma migrate dev`
-- ever proposes DROP INDEX for the indexes below, delete those lines from the generated migration.

-- Public listings: only ACTIVE, not deleted. Matches the default sort, so the first page is read in order
-- instead of sorting every active listing.
CREATE INDEX IF NOT EXISTS "Property_public_newest_idx"
  ON "Property" ("isFeatured" DESC, "listedAt" DESC, "id") WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Property_public_price_idx"
  ON "Property" ("price", "id") WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;
-- Counts, "starting from" per type, and per-compound summaries read only this narrow index.
CREATE INDEX IF NOT EXISTS "Property_public_expiry_idx"
  ON "Property" ("expiresAt") INCLUDE ("type", "price", "compoundId", "regionId") WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

-- Admin listing table (newest edits first).
CREATE INDEX IF NOT EXISTS "Property_admin_updated_idx" ON "Property" ("updatedAt" DESC) WHERE "deletedAt" IS NULL;

-- Free-text search ("q") uses ILIKE '%…%' on title, English title and address; trigram indexes make that
-- an index lookup instead of reading every listing. Works for Arabic and English.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Property_title_trgm_idx" ON "Property" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Property_titleEn_trgm_idx" ON "Property" USING gin ("titleEn" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Property_address_trgm_idx" ON "Property" USING gin ("address" gin_trgm_ops);

-- Analytics: date-range scans of inquiries ("PropertyViewDaily" already has an index on day).
CREATE INDEX IF NOT EXISTS "Inquiry_createdAt_idx" ON "Inquiry" ("createdAt") INCLUDE ("propertyId", "status");
