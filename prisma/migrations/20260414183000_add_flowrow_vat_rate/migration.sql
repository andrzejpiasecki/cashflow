ALTER TABLE "FlowRow"
ADD COLUMN "vatRate" DOUBLE PRECISION;

UPDATE "FlowRow"
SET "vatRate" = 8
WHERE "isImported" = true
  AND "vatRate" IS NULL;
