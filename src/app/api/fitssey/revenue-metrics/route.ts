import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

type SalesRow = {
  saleDate?: string;
  itemTotalPrice?: number | string;
  itemPrice?: number | string;
};

const FITSSEY_BASE_URL_TEMPLATE = "https://app.fitssey.com/{uuid}/api/v4/public";
const PAGE_SIZE = 200;
const DEFAULT_START_DATE = "2025-10-01";

function getFitsseySettingsDelegate() {
  return (db as unknown as { fitsseySettings?: typeof db.fitsseySettings }).fitsseySettings;
}

async function getFitsseyCredentials() {
  const settingsDelegate = getFitsseySettingsDelegate();
  if (!settingsDelegate) {
    throw new Error("Brak delegata FitsseySettings.");
  }

  const settings = (await settingsDelegate.findUnique({ where: { userId: SHARED_SCOPE_ID } }))
    ?? (await settingsDelegate.findFirst({ orderBy: { updatedAt: "desc" } }));
  const studioUuid = settings?.studioUuid?.trim() || process.env.FITSSEY_STUDIO_UUID?.trim() || "";
  const apiKey = settings?.apiKey?.trim() || process.env.FITSSEY_API_KEY?.trim() || "";
  const startDate = settings?.startDate ? settings.startDate.toISOString().slice(0, 10) : process.env.FITSSEY_START_DATE?.trim() || DEFAULT_START_DATE;
  if (!studioUuid || !apiKey) {
    throw new Error("Brak konfiguracji Fitssey (studioUuid/apiKey).");
  }
  return { studioUuid, apiKey, startDate };
}

async function fetchSalesPage(baseUrl: string, headers: HeadersInit, startDate: string, endDate: string, page: number) {
  const url = `${baseUrl}/report/finance/sales?startDate=${startDate}&endDate=${endDate}&page=${page}&count=${PAGE_SIZE}`;
  const response = await fetch(url, {
    method: "GET",
    headers,
    next: { revalidate: 900 },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fitssey API ${response.status}: ${body.slice(0, 140)}`);
  }
  return response.json() as Promise<unknown>;
}

function mapSalesRow(row: SalesRow) {
  const date = new Date(row.saleDate ?? "");
  if (Number.isNaN(date.getTime())) return null;
  const itemTotalPrice = Number(row.itemTotalPrice);
  const itemPrice = Number(row.itemPrice);
  const amountMinor = Number.isFinite(itemTotalPrice) ? itemTotalPrice : itemPrice;
  const amount = Number.isFinite(amountMinor) ? amountMinor / 100 : 0;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { date, amount };
}

async function fetchSalesRecords() {
  const { studioUuid, apiKey, startDate } = await getFitsseyCredentials();
  const endDate = new Date().toISOString().slice(0, 10);
  const baseUrl = FITSSEY_BASE_URL_TEMPLATE.replace("{uuid}", encodeURIComponent(studioUuid));
  const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}` };

  const first = await fetchSalesPage(baseUrl, headers, startDate, endDate, 1);
  const rows: SalesRow[] = [];
  if (Array.isArray(first)) {
    rows.push(...first);
  } else if (first && typeof first === "object" && Array.isArray((first as { collection?: SalesRow[] }).collection)) {
    rows.push(...((first as { collection: SalesRow[] }).collection ?? []));
    const pages = Number((first as { pages?: number }).pages) || 1;
    for (let page = 2; page <= pages; page += 1) {
      const next = await fetchSalesPage(baseUrl, headers, startDate, endDate, page);
      if (Array.isArray(next)) rows.push(...next);
      else if (next && typeof next === "object" && Array.isArray((next as { collection?: SalesRow[] }).collection)) {
        rows.push(...((next as { collection: SalesRow[] }).collection ?? []));
      }
    }
  } else {
    throw new Error("Nieprawidłowy format odpowiedzi Fitssey.");
  }

  return rows.map(mapSalesRow).filter((record): record is { date: Date; amount: number } => Boolean(record));
}

function buildComparableMonthToDateRevenue(records: { date: Date; amount: number }[]) {
  const now = new Date();
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1, 0, 0, 0, 0);
  const prevLastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate();
  const comparableDay = Math.min(now.getDate(), prevLastDay);
  const prevComparableEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), comparableDay, 23, 59, 59, 999);
  const prevFullEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59, 999);

  const sumInRange = (start: Date, end: Date) =>
    records.reduce((sum, row) => {
      const t = row.date.getTime();
      return t >= start.getTime() && t <= end.getTime() ? sum + row.amount : sum;
    }, 0);

  const currentPeriodRevenue = sumInRange(currentStart, currentEnd);
  const previousPeriodRevenue = sumInRange(prevStart, prevComparableEnd);
  const previousFullMonthRevenue = sumInRange(prevStart, prevFullEnd);
  const revenueMoMChange = previousPeriodRevenue > 0 ? ((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100 : null;

  return { currentPeriodRevenue, previousPeriodRevenue, previousFullMonthRevenue, revenueMoMChange };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const records = await fetchSalesRecords();
    return NextResponse.json(buildComparableMonthToDateRevenue(records));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się pobrać metryk przychodu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
