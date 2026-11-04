-- LAND-299: job cost reports look up each job's material consumption in the cost ledger by documentId
-- (the job id). There was no index on it, so every lookup read the whole ledger.
CREATE INDEX IF NOT EXISTS "costLedger_documentId_idx" ON "costLedger" ("documentId") WHERE "documentId" IS NOT NULL;
