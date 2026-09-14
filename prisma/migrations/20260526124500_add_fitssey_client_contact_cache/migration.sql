CREATE TABLE "FitsseyClientContact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientKey" TEXT NOT NULL,
  "clientGuid" TEXT,
  "clientUuid" TEXT,
  "fullName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FitsseyClientContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FitsseyClientContact_userId_clientKey_key" ON "FitsseyClientContact"("userId", "clientKey");
CREATE INDEX "FitsseyClientContact_userId_clientGuid_idx" ON "FitsseyClientContact"("userId", "clientGuid");
CREATE INDEX "FitsseyClientContact_userId_clientUuid_idx" ON "FitsseyClientContact"("userId", "clientUuid");
CREATE INDEX "FitsseyClientContact_userId_normalizedName_idx" ON "FitsseyClientContact"("userId", "normalizedName");

INSERT INTO "FitsseyClientContact" (
  "id", "userId", "clientKey", "clientGuid", "clientUuid", "fullName", "normalizedName", "email", "phone", "createdAt", "updatedAt"
)
SELECT
  'fcc_' || md5("userId" || ':' || lower("externalGuid")),
  "userId",
  lower("externalGuid"),
  "externalGuid",
  "clientUuid",
  "fullName",
  "normalizedName",
  "email",
  "phone",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "FitsseyClient"
WHERE "externalGuid" IS NOT NULL AND trim("externalGuid") <> ''
ON CONFLICT ("userId", "clientKey") DO UPDATE SET
  "clientGuid" = COALESCE("FitsseyClientContact"."clientGuid", EXCLUDED."clientGuid"),
  "clientUuid" = COALESCE("FitsseyClientContact"."clientUuid", EXCLUDED."clientUuid"),
  "fullName" = EXCLUDED."fullName",
  "normalizedName" = EXCLUDED."normalizedName",
  "email" = COALESCE("FitsseyClientContact"."email", EXCLUDED."email"),
  "phone" = COALESCE("FitsseyClientContact"."phone", EXCLUDED."phone"),
  "updatedAt" = CURRENT_TIMESTAMP;

WITH sale_contacts AS (
  SELECT
    "userId",
    COALESCE(NULLIF(lower("userGuid"), ''), NULLIF(lower("clientUuid"), ''), CASE WHEN "userEmail" IS NOT NULL AND trim("userEmail") <> '' THEN 'email:' || lower("userEmail") ELSE NULL END, 'name:' || lower(regexp_replace("userFullName", '\\s+', ' ', 'g'))) AS "clientKey",
    "userGuid",
    "clientUuid",
    "userFullName",
    lower(regexp_replace("userFullName", '\\s+', ' ', 'g')) AS "normalizedName",
    "userEmail",
    "userPhone",
    "saleDate"
  FROM "FitsseySale"
  WHERE "userFullName" IS NOT NULL AND trim("userFullName") <> ''
), deduped_sale_contacts AS (
  SELECT DISTINCT ON ("userId", "clientKey") *
  FROM sale_contacts
  ORDER BY "userId", "clientKey", ("userPhone" IS NOT NULL AND trim("userPhone") <> '') DESC, "saleDate" DESC
)
INSERT INTO "FitsseyClientContact" (
  "id", "userId", "clientKey", "clientGuid", "clientUuid", "fullName", "normalizedName", "email", "phone", "createdAt", "updatedAt"
)
SELECT
  'fcc_' || md5("userId" || ':' || "clientKey"),
  "userId",
  "clientKey",
  "userGuid",
  "clientUuid",
  "userFullName",
  "normalizedName",
  "userEmail",
  "userPhone",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM deduped_sale_contacts
ON CONFLICT ("userId", "clientKey") DO UPDATE SET
  "clientGuid" = COALESCE("FitsseyClientContact"."clientGuid", EXCLUDED."clientGuid"),
  "clientUuid" = COALESCE("FitsseyClientContact"."clientUuid", EXCLUDED."clientUuid"),
  "fullName" = EXCLUDED."fullName",
  "normalizedName" = EXCLUDED."normalizedName",
  "email" = COALESCE("FitsseyClientContact"."email", EXCLUDED."email"),
  "phone" = COALESCE("FitsseyClientContact"."phone", EXCLUDED."phone"),
  "updatedAt" = CURRENT_TIMESTAMP;
