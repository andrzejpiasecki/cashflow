import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { getCachedFitsseyClients } from "@/lib/fitssey-clients";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

type SalesRecord = {
  date: Date;
  month: string;
  dayKey: string;
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

const BUSINESS_TIME_ZONE = "Europe/Warsaw";

function getFitsseySettingsDelegate() {
  return (db as unknown as { fitsseySettings?: typeof db.fitsseySettings }).fitsseySettings;
}

function getFitsseySaleDelegate() {
  return (db as unknown as { fitsseySale?: typeof db.fitsseySale }).fitsseySale;
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

function isPassProduct(product: string) {
  const normalized = product.toLowerCase();
  return /karnet|pass|pakiet/.test(normalized)
    || /\d+\s*wej(?:ść|sc)/i.test(product)
    || /\d+\s*\+\s*\d+/.test(normalized);
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

async function getImportedRevenueSnapshot() {
  const rows = await db.flowRow.findMany({
    where: { userId: SHARED_SCOPE_ID, type: "income", isImported: true },
    select: { name: true, monthValues: true },
  });

  const revenueByMonth = new Map<string, number>();
  const mrrByMonth = new Map<string, number>();

  for (const row of rows) {
    const isPassRow = isPassProduct(row.name);
    const monthValues = row.monthValues as Record<string, unknown>;
    for (const [month, rawValue] of Object.entries(monthValues ?? {})) {
      const value = typeof rawValue === "number" ? rawValue : Number(rawValue) || 0;
      if (!Number.isFinite(value) || value === 0) continue;
      revenueByMonth.set(month, (revenueByMonth.get(month) || 0) + value);
      if (isPassRow) {
        mrrByMonth.set(month, (mrrByMonth.get(month) || 0) + value);
      }
    }
  }

  return { revenueByMonth, mrrByMonth };
}

async function getCachedSalesRecords(): Promise<SalesRecord[]> {
  const fitsseySale = getFitsseySaleDelegate();
  if (!fitsseySale) return [];

  const rows = await fitsseySale.findMany({
    where: { userId: SHARED_SCOPE_ID },
    orderBy: { saleDate: "asc" },
  });

  return rows.map((row) => {
    const clientGuid = safeText(row.userGuid) || null;
    const clientUuid = safeText(row.clientUuid) || null;
    const clientEmail = safeText(row.userEmail).toLowerCase() || null;
    const clientPhone = safeText(row.userPhone) || null;
    const clientName = safeText(row.userFullName) || "Nieznany klient";
    const clientKey = clientGuid?.toLowerCase()
      || clientUuid?.toLowerCase()
      || (clientEmail ? `email:${clientEmail}` : null)
      || (clientPhone ? `phone:${clientPhone}` : null)
      || `name:${normalizeName(clientName)}`;

    return {
      date: row.saleDate,
      month: row.saleMonthKey,
      dayKey: row.saleDayKey,
      clientName,
      clientKey,
      clientGuid,
      clientUuid,
      clientEmail,
      clientPhone,
      product: row.itemName,
      amount: row.amount,
      isPass: isPassProduct(row.itemName),
    };
  });
}

function buildDailyRevenueSeries(records: SalesRecord[]) {
  const byDay = new Map<string, number>();
  for (const row of records) {
    byDay.set(row.dayKey, (byDay.get(row.dayKey) || 0) + row.amount);
  }

  const now = getNowInTimeZone(BUSINESS_TIME_ZONE);
  const year = now.year;
  const month = now.month - 1;
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
  const now = getNowInTimeZone(BUSINESS_TIME_ZONE);
  const currentMonthKey = `${now.year}-${String(now.month).padStart(2, "0")}`;
  const currentStartKey = `${currentMonthKey}-01`;
  const currentEndKey = `${currentMonthKey}-${String(now.day).padStart(2, "0")}`;

  const prevMonth = new Date(now.year, now.month - 2, 1);
  const previousMonthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const prevLastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate();
  const comparableDay = Math.min(now.day, prevLastDay);
  const prevStartKey = `${previousMonthKey}-01`;
  const prevComparableEndKey = `${previousMonthKey}-${String(comparableDay).padStart(2, "0")}`;
  const prevFullEndKey = `${previousMonthKey}-${String(prevLastDay).padStart(2, "0")}`;

  const sumByDayRange = (startKey: string, endKey: string) =>
    records.reduce((sum, row) => (row.dayKey >= startKey && row.dayKey <= endKey ? sum + row.amount : sum), 0);

  const currentPeriodRevenue = sumByDayRange(currentStartKey, currentEndKey);
  const previousPeriodRevenue = sumByDayRange(prevStartKey, prevComparableEndKey);
  const previousFullMonthRevenue = sumByDayRange(prevStartKey, prevFullEndKey);
  const revenueMoMChange = previousPeriodRevenue > 0 ? ((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100 : null;

  return {
    currentMonthKey,
    previousMonthKey,
    currentPeriodRevenue,
    previousPeriodRevenue,
    previousFullMonthRevenue,
    revenueMoMChange,
  };
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
  importedSnapshot?: {
    revenueByMonth: Map<string, number>;
    mrrByMonth: Map<string, number>;
  },
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

  const importedMonths = importedSnapshot ? [...new Set([...importedSnapshot.revenueByMonth.keys(), ...importedSnapshot.mrrByMonth.keys()])] : [];
  const months = [...new Set([...records.map((row) => row.month), ...importedMonths])].sort();
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

  if (importedSnapshot) {
    for (const month of months) {
      revenueByMonth[month] = Math.round(importedSnapshot.revenueByMonth.get(month) || 0);
      mrrByMonth[month] = Math.round(importedSnapshot.mrrByMonth.get(month) || 0);
    }
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
  const totalRevenue = Object.values(revenueByMonth).reduce((sum, value) => sum + value, 0);
  const totalSales = records.length;
  const passSales = records.filter((row) => row.isPass).length;
  const avgTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
  const latestArpu = latestMonth ? arpuByMonth[latestMonth] || 0 : 0;
  const latestActive = latestMonth ? activeClientsByMonth[latestMonth] || 0 : 0;
  const latestChurn = latestMonth ? churnByMonth[latestMonth] || 0 : 0;
  const latestMrr = latestMonth ? mrrByMonth[latestMonth] || 0 : 0;
  const currentImportedRevenue = importedSnapshot ? Math.round(importedSnapshot.revenueByMonth.get(comparable.currentMonthKey) || 0) : 0;
  const previousImportedRevenue = importedSnapshot ? Math.round(importedSnapshot.revenueByMonth.get(comparable.previousMonthKey) || 0) : 0;
  const hasComparableSales = records.some((row) => row.month === comparable.currentMonthKey || row.month === comparable.previousMonthKey);
  const currentPeriodRevenue = hasComparableSales ? comparable.currentPeriodRevenue : currentImportedRevenue;
  const previousPeriodRevenue = hasComparableSales ? comparable.previousPeriodRevenue : 0;
  const previousFullMonthRevenue = hasComparableSales ? comparable.previousFullMonthRevenue : previousImportedRevenue;
  const revenueMoMChange = previousPeriodRevenue > 0 ? ((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100 : null;

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
    currentPeriodRevenue,
    previousPeriodRevenue,
    previousFullMonthRevenue,
    revenueMoMChange,
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
    const settingsDelegate = getFitsseySettingsDelegate();
    const settings = settingsDelegate
      ? (await settingsDelegate.findUnique({ where: { userId: SHARED_SCOPE_ID } }))
        ?? (await settingsDelegate.findFirst({ orderBy: { updatedAt: "desc" } }))
      : null;
    const studioUuid = settings?.studioUuid?.trim() || process.env.FITSSEY_STUDIO_UUID?.trim() || "";
    const cachedClients = await getCachedFitsseyClients();
    const records = await getCachedSalesRecords();
    const importedSnapshot = await getImportedRevenueSnapshot();
    const analytics = buildAnalytics(records, cachedClients, importedSnapshot);
    return NextResponse.json({
      ...analytics,
      studioUuid,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard fetch failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
