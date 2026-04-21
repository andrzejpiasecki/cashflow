CREATE TABLE "public"."CashflowSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountBalance" DOUBLE PRECISION,
    "accountBalanceMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashflowSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashflowSettings_userId_key" ON "public"."CashflowSettings"("userId");
CREATE INDEX "CashflowSettings_userId_idx" ON "public"."CashflowSettings"("userId");
