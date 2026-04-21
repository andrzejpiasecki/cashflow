CREATE TABLE "public"."FitsseySale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "saleDayKey" TEXT NOT NULL,
    "saleMonthKey" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "userGuid" TEXT,
    "clientUuid" TEXT,
    "userFullName" TEXT NOT NULL,
    "userEmail" TEXT,
    "userPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FitsseySale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FitsseySale_userId_saleDate_idx" ON "public"."FitsseySale"("userId", "saleDate");
CREATE INDEX "FitsseySale_userId_saleDayKey_idx" ON "public"."FitsseySale"("userId", "saleDayKey");
CREATE INDEX "FitsseySale_userId_saleMonthKey_idx" ON "public"."FitsseySale"("userId", "saleMonthKey");
CREATE INDEX "FitsseySale_userId_userGuid_idx" ON "public"."FitsseySale"("userId", "userGuid");
CREATE INDEX "FitsseySale_userId_clientUuid_idx" ON "public"."FitsseySale"("userId", "clientUuid");
