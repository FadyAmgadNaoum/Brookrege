-- Phase 3 · Week 12: personal-data retention and erasure (docs/security/PRIVACY.md)

ALTER TABLE "Inquiry" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
ALTER TABLE "PropertySubmission" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- Lookups by phone (a person asking "what do you hold about me?") and the nightly retention sweep.
CREATE INDEX "Inquiry_phone_idx" ON "Inquiry"("phone");
CREATE INDEX "Inquiry_updatedAt_idx" ON "Inquiry"("updatedAt");
CREATE INDEX "PropertySubmission_phone_idx" ON "PropertySubmission"("phone");
CREATE INDEX "PropertySubmission_updatedAt_idx" ON "PropertySubmission"("updatedAt");
