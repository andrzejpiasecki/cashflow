import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { getCachedFitsseyClients, syncFitsseyClientEntriesForUsers, syncFitsseyClientsCache } from "@/lib/fitssey-clients";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

type SalesRow = {
  saleDate?: string;
  itemName?: string;
  itemTotalPrice?: number | string;
  itemPrice?: number | string;
  userGuid?: string;
  clientUuid?: string;
  userFullName?: string;
  userEmail?: string;
  email?: string;
  userPhone?: string;
  phone?: string;
  phoneNumber?: string;
};

type SalesRecord = {
  date: Date;
  month: string;
  clientName: string;
  clientKey: string;
  clientGuid: string | null;
  clientUuid: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  product: string;
  amount: number;
  isPass: boolean;
};

const FITSSEY_BASE_URL_TEMPLATE = "https://app.fitssey.com/{uuid}/api/v4/public";
const PAGE_SIZE = 200;
const DEFAULT_START_DATE = "2025-10-01";

function getFitsseySettingsDelegate() {
  return (db as unknown as { fitsseySettings?: typeof db.fitsseySettings }).fitsseySettings;
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createMonthlyObject(months: string[], initialValue: number) {
  return Object.fromEntries(months.map((month) => [month, initialValue]));
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeName(value: unknown) {
  return safeText(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeEmail(value: unknown) {
  const email = safeText(value).toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

function normalizePhone(value: unknown) {
  const raw = safeText(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned.length >= 6 ? cleaned : null;
}

function isPassProduct(product: string) {
  const normalized = product.toLowerCase();
  return /karnet|pass|pakiet/.test(normalized)
    || /\d+\s*wej(?:ść|sc)/i.test(product)
    || /\d+\s*\+\s*\d+/.test(normalized);
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

function mapSalesRow(row: SalesRow): SalesRecord | null {
  const date = new Date(row.saleDate ?? "");
  if (Number.isNaN(date.getTime())) return null;
  const itemTotalPrice = Number(row.itemTotalPrice);
  const itemPrice = Number(row.itemPrice);
  const amountMinor = Number.isFinite(itemTotalPrice) ? itemTotalPrice : itemPrice;
  const amount = Number.isFinite(amountMinor) ? amountMinor / 100 : 0;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const product = safeText(row.itemName) || "Produkt";
  const clientName = safeText(row.userFullName) || "Nieznany klient";
  const clientGuid = safeText(row.userGuid) || null;
  const clientUuid = safeText(row.clientUuid) || null;
  const clientEmail = normalizeEmail(row.userEmail ?? row.email);
  const clientPhone = normalizePhone(row.userPhone ?? row.phone ?? row.phoneNumber);
  const clientKey = clientGuid?.toLowerCase() || clientUuid?.toLowerCase() || `name:${normalizeName(clientName)}`;
  return {
    date,
    month: toMonthKey(date),
    clientName,
    clientKey,
    clientGuid,
    clientUuid,
    clientEmail,
    clientPhone,
    product,
    amount,
    isPass: isPassProduct(product),
  };
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

  return rows.map(mapSalesRow).filter((record): record is SalesRecord => Boolean(record)).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function buildDailyRevenueSeries(records: SalesRecord[]) {
  const byDay = new Map<string, number>();
  for (const row of records) {
    const dayKey = toDayKey(row.date);
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + row.amount);
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const prevMonthDate = new Date(year, month - 1, 1);
  const prevYear = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth();

  const labels: string[] = [];
  const values: number[] = [];
  const previousValues: number[] = [];
  for (let day = 1; day <= 31; day += 1) {
    labels.push(String(day));
    const currentKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const previousKey = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    values.push(byDay.get(currentKey) || 0);
    previousValues.push(byDay.get(previousKey) || 0);
  }
  return { labels, values, previousValues };
}

function buildComparableMonthToDateRevenue(records: SalesRecord[]) {
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

function buildClientsSummary(records: SalesRecord[], months: string[]) {
  const byClient = new Map<string, { name: string; purchaseCount: number; totalAmount: number; purchasesByMonth: Record<string, number> }>();
  for (const row of records) {
    const existing = byClient.get(row.clientKey) ?? {
      name: row.clientName,
      purchaseCount: 0,
      totalAmount: 0,
      purchasesByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    };
    existing.purchaseCount += 1;
    existing.totalAmount += row.amount;
    existing.purchasesByMonth[row.month] = (existing.purchasesByMonth[row.month] || 0) + 1;
    byClient.set(row.clientKey, existing);
  }
  return [...byClient.values()].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 200);
}

function estimatePassCycleDays(passPurchaseDates: Date[]) {
  if (passPurchaseDates.length < 2) return 30;
  const sorted = [...passPurchaseDates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const days = Math.round((sorted[index].getTime() - sorted[index - 1].getTime()) / 86400000);
    if (days >= 7 && days <= 60) intervals.push(days);
  }
  if (intervals.length === 0) return 30;
  intervals.sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  const median = intervals.length % 2 === 0 ? Math.round((intervals[middle - 1] + intervals[middle]) / 2) : intervals[middle];
  return Math.max(21, Math.min(35, median));
}

function getPriority(score: number) {
  if (score >= 35) return "wysoki";
  if (score >= 18) return "sredni";
  return "niski";
}

function getFreshnessWeight(daysSince: number) {
  if (daysSince <= 60) return 1;
  if (daysSince <= 120) return 0.7;
  if (daysSince <= 180) return 0.4;
  if (daysSince <= 240) return 0.2;
  return 0;
}

function buildAnalytics(
  records: SalesRecord[],
  cachedClients: {
    externalGuid: string;
    clientUuid: string | null;
    normalizedName: string;
    email: string | null;
    phone: string | null;
    activeEntries: number | null;
  }[],
) {
  const clientsByGuid = new Map<string, { email: string | null; phone: string | null; activeEntries: number | null }>();
  const clientsByUuid = new Map<string, { email: string | null; phone: string | null; activeEntries: number | null }>();
  const clientsByName = new Map<string, { email: string | null; phone: string | null; activeEntries: number | null }>();
  for (const row of cachedClients) {
    const contact = { email: row.email, phone: row.phone, activeEntries: row.activeEntries };
    const guidKey = safeText(row.externalGuid).toLowerCase();
    const uuidKey = safeText(row.clientUuid).toLowerCase();
    const nameKey = normalizeName(row.normalizedName);
    if (guidKey) clientsByGuid.set(guidKey, contact);
    if (uuidKey) clientsByUuid.set(uuidKey, contact);
    if (nameKey) clientsByName.set(nameKey, contact);
  }

  const months = [...new Set(records.map((row) => row.month))].sort();
  const latestMonth = months.at(-1) ?? null;
  const previousMonth = months.length > 1 ? months.at(-2) ?? null : null;
  const revenueByMonth = createMonthlyObject(months, 0);
  const mrrByMonth = createMonthlyObject(months, 0);
  const passesSoldByMonth = createMonthlyObject(months, 0);
  const salesByMonth = createMonthlyObject(months, 0);
  const newClientsByMonth = createMonthlyObject(months, 0);
  const returningClientsByMonth = createMonthlyObject(months, 0);
  const productCount: Record<string, number> = {};
  const uniqueClientsByMonth: Record<string, Set<string>> = Object.fromEntries(months.map((month) => [month, new Set<string>()]));
  const clientFirstMonth: Record<string, string> = {};

  for (const row of records) {
    revenueByMonth[row.month] += row.amount;
    salesByMonth[row.month] += 1;
    if (row.isPass) {
      mrrByMonth[row.month] += row.amount;
      passesSoldByMonth[row.month] += 1;
    }
    productCount[row.product] = (productCount[row.product] || 0) + 1;
    uniqueClientsByMonth[row.month].add(row.clientKey);
    if (!clientFirstMonth[row.clientKey]) clientFirstMonth[row.clientKey] = row.month;
  }

  for (const month of months) {
    for (const client of uniqueClientsByMonth[month]) {
      if (clientFirstMonth[client] === month) newClientsByMonth[month] += 1;
      else returningClientsByMonth[month] += 1;
    }
  }

  const activeClientsByMonth = createMonthlyObject(months, 0);
  const churnByMonth = createMonthlyObject(months, 0);
  const arpuByMonth = createMonthlyObject(months, 0);
  const clientStats = new Map<
    string,
    {
      name: string;
      lifetimeRevenue: number;
      purchaseCount: number;
      lastPurchaseDate: Date;
      lastPassPurchaseDate: Date | null;
      passPurchaseDates: Date[];
      purchaseMonths: Set<string>;
      passMonths: Set<string>;
      singleEntryCount: number;
      lastSingleEntryDate: Date | null;
      activeEntries: number | null;
      clientGuid: string | null;
      email: string | null;
      phone: string | null;
    }
  >();
  for (let i = 0; i < months.length; i += 1) {
    const month = months[i];
    activeClientsByMonth[month] = uniqueClientsByMonth[month].size;
    arpuByMonth[month] = uniqueClientsByMonth[month].size > 0 ? revenueByMonth[month] / uniqueClientsByMonth[month].size : 0;
    if (i > 0) {
      const prev = uniqueClientsByMonth[months[i - 1]];
      const curr = uniqueClientsByMonth[month];
      const retained = [...prev].filter((client) => curr.has(client)).length;
      churnByMonth[month] = prev.size ? ((prev.size - retained) / prev.size) * 100 : 0;
    }
  }

  const comparable = buildComparableMonthToDateRevenue(records);
  const totalRevenue = records.reduce((sum, row) => sum + row.amount, 0);
  const totalSales = records.length;
  const passSales = records.filter((row) => row.isPass).length;
  const avgTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
  const latestArpu = latestMonth ? arpuByMonth[latestMonth] || 0 : 0;
  const latestActive = latestMonth ? activeClientsByMonth[latestMonth] || 0 : 0;
  const latestChurn = latestMonth ? churnByMonth[latestMonth] || 0 : 0;
  const latestMrr = latestMonth ? mrrByMonth[latestMonth] || 0 : 0;

  for (const row of records) {
    const cachedContact = (row.clientGuid && clientsByGuid.get(row.clientGuid.toLowerCase()))
      || (row.clientUuid && clientsByUuid.get(row.clientUuid.toLowerCase()))
      || clientsByName.get(normalizeName(row.clientName))
      || null;

    const stat = clientStats.get(row.clientKey) ?? {
      name: row.clientName,
      lifetimeRevenue: 0,
      purchaseCount: 0,
      lastPurchaseDate: row.date,
      lastPassPurchaseDate: null,
      passPurchaseDates: [],
      purchaseMonths: new Set<string>(),
      passMonths: new Set<string>(),
      singleEntryCount: 0,
      lastSingleEntryDate: null,
      activeEntries: cachedContact?.activeEntries ?? null,
      clientGuid: row.clientGuid,
      email: row.clientEmail ?? cachedContact?.email ?? null,
      phone: row.clientPhone ?? cachedContact?.phone ?? null,
    };
    stat.name = row.clientName;
    stat.lifetimeRevenue += row.amount;
    stat.purchaseCount += 1;
    if (row.date > stat.lastPurchaseDate) stat.lastPurchaseDate = row.date;
    stat.purchaseMonths.add(row.month);
    if (row.isPass) {
      stat.passPurchaseDates.push(row.date);
      stat.passMonths.add(row.month);
      if (!stat.lastPassPurchaseDate || row.date > stat.lastPassPurchaseDate) stat.lastPassPurchaseDate = row.date;
    } else if (/wejsc|wejść|jednoraz/i.test(row.product)) {
      stat.singleEntryCount += 1;
      if (!stat.lastSingleEntryDate || row.date > stat.lastSingleEntryDate) stat.lastSingleEntryDate = row.date;
    }
    if (!stat.email && row.clientEmail) stat.email = row.clientEmail;
    if (!stat.phone && row.clientPhone) stat.phone = row.clientPhone;
    if (!stat.clientGuid && row.clientGuid) stat.clientGuid = row.clientGuid;
    if (stat.activeEntries === null && cachedContact?.activeEntries !== null && cachedContact?.activeEntries !== undefined) {
      stat.activeEntries = cachedContact.activeEntries;
    }
    if (!stat.email && cachedContact?.email) stat.email = cachedContact.email;
    if (!stat.phone && cachedContact?.phone) stat.phone = cachedContact.phone;
    clientStats.set(row.clientKey, stat);
  }

  const contacts = [...clientStats.values()]
    .map((client) => {
      const nowTs = Date.now();
      const daysSinceLastPurchase = Math.max(0, Math.floor((Date.now() - client.lastPurchaseDate.getTime()) / 86400000));
      const daysSinceLastPass = client.lastPassPurchaseDate
        ? Math.max(0, Math.floor((nowTs - client.lastPassPurchaseDate.getTime()) / 86400000))
        : null;
      const daysSinceLastSingle = client.lastSingleEntryDate
        ? Math.max(0, Math.floor((nowTs - client.lastSingleEntryDate.getTime()) / 86400000))
        : null;
      const expectedCycleDays = client.lastPassPurchaseDate ? estimatePassCycleDays(client.passPurchaseDates) : null;
      const hasPassLatest = latestMonth ? client.passMonths.has(latestMonth) : false;
      const hasPurchaseLatest = latestMonth ? client.purchaseMonths.has(latestMonth) : false;
      // "Jednorazowe wejscie bez konwersji" only for clients that never bought a pass.
      const hasNotConvertedSingle = client.lastSingleEntryDate && client.passPurchaseDates.length === 0;

      let score = 0;
      let reason = "";

      if (hasNotConvertedSingle && daysSinceLastSingle !== null) {
        if (daysSinceLastSingle > 210) {
          score = 0;
          reason = "";
        } else {
        const freshness = getFreshnessWeight(daysSinceLastSingle);
        const recencyBonus = daysSinceLastSingle <= 45 ? 14 : daysSinceLastSingle <= 90 ? 8 : 0;
        score = (34 + Math.min(12, client.singleEntryCount * 2) + recencyBonus) * freshness;
        reason = "Jednorazowe wejscie bez konwersji na karnet";
        }
      } else if (client.lastPassPurchaseDate && !hasPassLatest && daysSinceLastPass !== null) {
        if (client.activeEntries !== null && client.activeEntries > 1) {
          score = 0;
          reason = "";
        } else if (daysSinceLastPass > 210) {
          score = 0;
          reason = "";
        } else {
          const overdue = daysSinceLastPass - (expectedCycleDays ?? 30);
          const overduePart = Math.min(26, Math.max(0, overdue) * 0.9);
          const ltvPart = Math.min(10, client.lifetimeRevenue / 400);
          const freshness = getFreshnessWeight(daysSinceLastPass);
          const lastEntriesBonus = client.activeEntries === 1 ? 8 : 0;
          score = (18 + overduePart + ltvPart + (hasPurchaseLatest ? 0 : 5) + lastEntriesBonus) * freshness;
          reason = client.activeEntries === 1
            ? "Ostatnie wejscie w karnecie - dobry moment na odnowienie"
            : (overdue > 5 ? "Karnet prawdopodobnie nie zostal odnowiony" : "Klient po karnecie bez kolejnego zakupu");
        }
      } else if (!hasPurchaseLatest && daysSinceLastPurchase >= 30) {
        if (daysSinceLastPurchase > 180) {
          score = 0;
          reason = "";
        } else {
          score = (12 + Math.min(12, daysSinceLastPurchase / 5)) * getFreshnessWeight(daysSinceLastPurchase);
          reason = "Brak zakupu od dluzszego czasu";
        }
      }

      return {
        name: client.name,
        lastPurchaseDate: client.lastPurchaseDate.toISOString(),
        daysSinceLastPurchase,
        lastPassPurchaseDate: client.lastPassPurchaseDate?.toISOString() ?? null,
        daysSinceLastPass,
        expectedCycleDays,
        lifetimeRevenue: client.lifetimeRevenue,
        activeEntries: client.activeEntries,
        clientGuid: client.clientGuid,
        email: client.email,
        phone: client.phone,
        reason,
        score: Math.round(score),
        priority: getPriority(score),
      };
    })
    .filter((client) => {
      if (!client.reason) return false;
      const isSingleEntryLead = client.reason.toLowerCase().includes("jednoraz");
      // Sales view should include a broader pool of single-entry leads.
      if (isSingleEntryLead) return client.score >= 6;
      return client.score >= 12;
    })
    .sort((a, b) => b.score - a.score || a.daysSinceLastPurchase - b.daysSinceLastPurchase || b.lifetimeRevenue - a.lifetimeRevenue)
    .slice(0, 200);

  const selectedMonths = [previousMonth, latestMonth].filter((month): month is string => Boolean(month));
  const selectedSet = new Set(selectedMonths);
  const latestClients = latestMonth ? uniqueClientsByMonth[latestMonth] : new Set<string>();
  const previousClients = previousMonth ? uniqueClientsByMonth[previousMonth] : new Set<string>();
  const segmentSales = records
    .filter((row) => selectedSet.has(row.month))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map((row) => ({
      month: row.month,
      date: row.date.toISOString(),
      clientName: row.clientName,
      product: row.product,
      amount: row.amount,
      monthLinkStatus:
        row.month === latestMonth
          ? previousClients.has(row.clientKey)
            ? "Kupował też w poprzednim"
            : "Brak zakupu w poprzednim"
          : latestClients.has(row.clientKey)
            ? "Kupił też w aktualnym"
            : "Brak zakupu w aktualnym",
      isNewForMonth: clientFirstMonth[row.clientKey] === row.month,
    }));

  return {
    months,
    latestMonth,
    previousMonth,
    totalRevenue,
    totalSales,
    latestActive,
    latestRevenue: latestMonth ? revenueByMonth[latestMonth] || 0 : 0,
    previousRevenue: previousMonth ? revenueByMonth[previousMonth] || 0 : 0,
    latestMrr,
    latestArpu,
    latestChurn,
    avgTicket,
    passShare: totalSales > 0 ? (passSales / totalSales) * 100 : 0,
    currentPeriodRevenue: comparable.currentPeriodRevenue,
    previousPeriodRevenue: comparable.previousPeriodRevenue,
    previousFullMonthRevenue: comparable.previousFullMonthRevenue,
    revenueMoMChange: comparable.revenueMoMChange,
    revenueByMonth,
    mrrByMonth,
    passesSoldByMonth,
    newClientsByMonth,
    returningClientsByMonth,
    productCount,
    activeClientsByMonth,
    dailyRevenue: buildDailyRevenueSeries(records),
    contacts,
    newClientSales: segmentSales.filter((sale) => sale.isNewForMonth).slice(0, 100),
    returningClientSales: segmentSales.filter((sale) => !sale.isNewForMonth).slice(0, 100),
    clientsSummary: buildClientsSummary(records, months),
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const credentials = await getFitsseyCredentials();
    const cachedClients = await getCachedFitsseyClients();
    // Never block dashboard render on client-cache sync.
    if (cachedClients.length === 0) {
      void Promise.resolve(credentials)
        .then((c) => syncFitsseyClientsCache(c.studioUuid, c.apiKey))
        .catch((error) => {
          console.error("Fitssey clients async cache sync failed:", error);
        });
    }
    const records = await fetchSalesRecords();
    const leadUsersToRefresh = records
      .slice(-320)
      .map((row) => ({ externalGuid: row.clientGuid ?? "", clientUuid: row.clientUuid }))
      .filter((row) => row.externalGuid);
    void syncFitsseyClientEntriesForUsers(credentials.studioUuid, credentials.apiKey, leadUsersToRefresh).catch((error) => {
      console.error("Fitssey entries async cache sync failed:", error);
    });
    const analytics = buildAnalytics(records, cachedClients);
    return NextResponse.json({
      ...analytics,
      studioUuid: credentials.studioUuid,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard fetch failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
