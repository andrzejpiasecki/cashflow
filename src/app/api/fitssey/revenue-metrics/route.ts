import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

const BUSINESS_TIME_ZONE = "Europe/Warsaw";

function getFitsseySaleDelegate() {
  return (db as unknown as { fitsseySale?: typeof db.fitsseySale }).fitsseySale;
}

function getNowInTimeZone(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    const fallback = new Date();
    return { year: fallback.getFullYear(), month: fallback.getMonth() + 1, day: fallback.getDate() };
  }
  return { year, month, day };
}

function getComparableBounds() {
  const now = getNowInTimeZone(BUSINESS_TIME_ZONE);
  const currentMonthKey = `${now.year}-${String(now.month).padStart(2, "0")}`;
  const currentStartKey = `${currentMonthKey}-01`;
  const currentEndKey = `${currentMonthKey}-${String(now.day).padStart(2, "0")}`;

  const previousMonth = new Date(now.year, now.month - 2, 1);
  const previousMonthKey = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}`;
  const previousStartKey = `${previousMonthKey}-01`;
  const previousLastDay = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0).getDate();
  const comparableDay = Math.min(now.day, previousLastDay);
  const previousComparableEndKey = `${previousMonthKey}-${String(comparableDay).padStart(2, "0")}`;
  const previousFullEndKey = `${previousMonthKey}-${String(previousLastDay).padStart(2, "0")}`;

  return {
    currentMonthKey,
    previousMonthKey,
    currentStartKey,
    currentEndKey,
    previousStartKey,
    previousComparableEndKey,
    previousFullEndKey,
  };
}

async function getImportedRevenueTotals(monthKeys: string[]) {
  const importedRows = await db.flowRow.findMany({
    where: { userId: SHARED_SCOPE_ID, type: "income", isImported: true },
    select: { monthValues: true },
  });

  const totals = new Map(monthKeys.map((monthKey) => [monthKey, 0]));
  for (const row of importedRows) {
    const monthValues = row.monthValues as Record<string, unknown>;
    for (const monthKey of monthKeys) {
      const rawValue = monthValues?.[monthKey];
      const value = typeof rawValue === "number" ? rawValue : Number(rawValue) || 0;
      if (!Number.isFinite(value) || value === 0) continue;
      totals.set(monthKey, (totals.get(monthKey) || 0) + value);
    }
  }

  return totals;
}

async function getComparableRevenueMetrics() {
  const bounds = getComparableBounds();
  const fitsseySale = getFitsseySaleDelegate();
  const salesRows = fitsseySale
    ? await fitsseySale.findMany({
      where: {
        userId: SHARED_SCOPE_ID,
        saleDayKey: {
          gte: bounds.previousStartKey,
          lte: bounds.currentEndKey,
        },
      },
      select: {
        saleDayKey: true,
        amount: true,
      },
    })
    : [];

  const importedTotals = await getImportedRevenueTotals([bounds.currentMonthKey, bounds.previousMonthKey]);

  let currentPeriodRevenue = 0;
  let previousPeriodRevenue = 0;
  let previousFullMonthRevenue = 0;

  for (const row of salesRows) {
    if (row.saleDayKey >= bounds.currentStartKey && row.saleDayKey <= bounds.currentEndKey) {
      currentPeriodRevenue += row.amount;
    }
    if (row.saleDayKey >= bounds.previousStartKey && row.saleDayKey <= bounds.previousComparableEndKey) {
      previousPeriodRevenue += row.amount;
    }
    if (row.saleDayKey >= bounds.previousStartKey && row.saleDayKey <= bounds.previousFullEndKey) {
      previousFullMonthRevenue += row.amount;
    }
  }

  if (salesRows.length === 0) {
    currentPeriodRevenue = importedTotals.get(bounds.currentMonthKey) || 0;
    previousFullMonthRevenue = importedTotals.get(bounds.previousMonthKey) || 0;
  }

  currentPeriodRevenue = Math.round(currentPeriodRevenue);
  previousPeriodRevenue = Math.round(previousPeriodRevenue);
  previousFullMonthRevenue = Math.round(previousFullMonthRevenue);

  return {
    currentPeriodRevenue,
    previousPeriodRevenue,
    previousFullMonthRevenue,
    revenueMoMChange: previousPeriodRevenue > 0
      ? ((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100
      : null,
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getComparableRevenueMetrics());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się pobrać metryk przychodu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
