ALTER TABLE "public"."FitsseyClient"
ADD COLUMN "activeEntries" INTEGER,
ADD COLUMN "entriesSource" TEXT,
ADD COLUMN "entriesUpdatedAt" TIMESTAMP(3);
