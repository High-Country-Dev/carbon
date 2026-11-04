-- LAND-299 (ABS: Steve, Eric or Chris sign off on a quote or PO before it goes out).
-- Our own sign-off step: Carbon's approvals live in packages/ee (Enterprise) and are not used (LAND-271).
-- Finalize stays disabled until someone with Resources access signs off; the sign-off is kept with who and when.
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signedOffBy" TEXT REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signedOffAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "purchaseOrder" ADD COLUMN IF NOT EXISTS "signedOffBy" TEXT REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "purchaseOrder" ADD COLUMN IF NOT EXISTS "signedOffAt" TIMESTAMP WITH TIME ZONE;
