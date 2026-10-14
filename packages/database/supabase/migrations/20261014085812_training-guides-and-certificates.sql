-- A training can carry one PDF guide, and an External training is completed by
-- uploading a certificate instead of passing the quiz.
ALTER TABLE "training"
  ADD COLUMN "guidePath" TEXT,
  ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "trainingCompletion"
  ADD COLUMN "certificatePath" TEXT;
