ALTER TABLE "FitsseySettings" ALTER COLUMN "autoImportIntervalMins" SET DEFAULT 5;
UPDATE "FitsseySettings" SET "autoImportIntervalMins" = 5 WHERE "autoImportIntervalMins" = 180;
