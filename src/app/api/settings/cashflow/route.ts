import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

function getCashflowSettingsDelegate() {
  return (db as unknown as { cashflowSettings?: typeof db.cashflowSettings }).cashflowSettings;
}

function isMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cashflowSettings = getCashflowSettingsDelegate();
  if (!cashflowSettings) {
    return NextResponse.json(
      { error: "Prisma client bez modelu CashflowSettings. Uruchom: yarn prisma generate i zrestartuj dev server." },
      { status: 503 },
    );
  }

  const settings = await cashflowSettings.findUnique({
    where: { userId: SHARED_SCOPE_ID },
  });

  return NextResponse.json({
    accountBalance: settings?.accountBalance ?? null,
    accountBalanceMonth: settings?.accountBalanceMonth ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cashflowSettings = getCashflowSettingsDelegate();
  if (!cashflowSettings) {
    return NextResponse.json(
      { error: "Prisma client bez modelu CashflowSettings. Uruchom: yarn prisma generate i zrestartuj dev server." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    accountBalance?: number | null;
    accountBalanceMonth?: string | null;
  };

  const rawBalance = body.accountBalance;
  const accountBalance = rawBalance === null || rawBalance === undefined ? null : Number(rawBalance);
  const accountBalanceMonth = typeof body.accountBalanceMonth === "string" && body.accountBalanceMonth.trim()
    ? body.accountBalanceMonth.trim()
    : null;

  if (accountBalance !== null && !Number.isFinite(accountBalance)) {
    return NextResponse.json({ error: "Niepoprawny stan konta." }, { status: 400 });
  }

  if (accountBalanceMonth !== null && !isMonthKey(accountBalanceMonth)) {
    return NextResponse.json({ error: "Niepoprawny miesiąc dla stanu konta." }, { status: 400 });
  }

  if ((accountBalance === null) !== (accountBalanceMonth === null)) {
    return NextResponse.json({ error: "Podaj jednocześnie kwotę i miesiąc dla stanu konta." }, { status: 400 });
  }

  const saved = await cashflowSettings.upsert({
    where: { userId: SHARED_SCOPE_ID },
    create: {
      userId: SHARED_SCOPE_ID,
      accountBalance,
      accountBalanceMonth,
    },
    update: {
      accountBalance,
      accountBalanceMonth,
    },
  });

  return NextResponse.json({
    accountBalance: saved.accountBalance ?? null,
    accountBalanceMonth: saved.accountBalanceMonth ?? null,
  });
}
