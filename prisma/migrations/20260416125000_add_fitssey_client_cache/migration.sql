CREATE TABLE "public"."FitsseyClient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalGuid" TEXT NOT NULL,
    "clientUuid" TEXT,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FitsseyClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FitsseyClient_userId_externalGuid_key" ON "public"."FitsseyClient"("userId", "externalGuid");
CREATE INDEX "FitsseyClient_userId_clientUuid_idx" ON "public"."FitsseyClient"("userId", "clientUuid");
CREATE INDEX "FitsseyClient_userId_normalizedName_idx" ON "public"."FitsseyClient"("userId", "normalizedName");
