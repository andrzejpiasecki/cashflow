import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

type FitsseyAuthMode = "apiKey";

type FitsseyAuthConfig = {
  studioUuid: string;
  mode: FitsseyAuthMode;
  apiKey: string;
  startDate: string;
};

type FitsseySalesRow = {
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
  mobilePhone?: string;
  contactPhone?: string;
  user?: {
    phone?: string;
    phoneNumber?: string;
    mobilePhone?: string;
  };
  client?: {
    phone?: string;
    phoneNumber?: string;
    mobilePhone?: string;
  };
  vatRate?: number | string;
  itemVatRate?: number | string;
  taxRate?: number | string;
  itemTaxRate?: number | string;
  itemVat?: number | string;
  itemTax?: number | string;
};

type FitsseyClientPricingOptionRow = {
  activatedAt?: string;
  clientUuid?: string;
  expiresAt?: string;
  guid?: string;
  qualifiedName?: string;
  userGuid?: string;
};

type MappedFitsseySale = {
  userId: string;
  saleDate: Date;
  saleDayKey: string;
  saleMonthKey: string;
  itemName: string;
  amount: number;
  userGuid: string | null;
  clientUuid: string | null;
  userFullName: string;
  userEmail: string | null;
  userPhone: string | null;
  passActivatedDayKey: string | null;
  passExpiresDayKey: string | null;
  passInstanceGuid: string | null;
};

const FITSSEY_BASE_URL_TEMPLATE = "https://app.fitssey.com/{uuid}/api/v4/public";
const PAGE_SIZE = 200;
const DEFAULT_START_DATE = "2025-10-01";
const DEFAULT_AUTO_IMPORT_INTERVAL_MINS = 180;
const RUNNING_IMPORT_LOCK_MINS = 10;

function hasFitsseySettingsDelegate() {
  return "fitsseySettings" in (db as unknown as Record<string, unknown>);
}

function hasFitsseySaleDelegate() {
  return "fitsseySale" in (db as unknown as Record<string, unknown>);
}

function getFitsseyClientContactDelegate() {
  return (db as unknown as { fitsseyClientContact?: typeof db.fitsseyClientContact }).fitsseyClientContact;
}

async function updateImportStatus(status: string, importedAt?: Date) {
  if (!hasFitsseySettingsDelegate()) return;
  await db.fitsseySettings.updateMany({
    where: { userId: SHARED_SCOPE_ID },
    data: importedAt ? { lastImportedAt: importedAt, lastImportStatus: status } : { lastImportStatus: status },
  });
}

async function getImportSettings() {
  if (!hasFitsseySettingsDelegate()) return null;
  return (await db.fitsseySettings.findUnique({ where: { userId: SHARED_SCOPE_ID } }))
    ?? (await db.fitsseySettings.findFirst({ orderBy: { updatedAt: "desc" } }));
}

function minutesSince(date: Date, now: Date) {
  return (now.getTime() - date.getTime()) / 60000;
}

async function shouldRunAutoImport(now: Date) {
  const settings = await getImportSettings();
  if (!settings) {
    return { run: false, reason: "missing_settings" };
  }
  if (!settings.autoImportEnabled) {
    return { run: false, reason: "auto_disabled" };
  }

  const runningRecently = settings.lastImportStatus?.startsWith("running:") && minutesSince(settings.updatedAt, now) < RUNNING_IMPORT_LOCK_MINS;
  if (runningRecently) {
    return { run: false, reason: "already_running" };
  }

  const intervalMins = Math.max(15, settings.autoImportIntervalMins || DEFAULT_AUTO_IMPORT_INTERVAL_MINS);
  if (settings.lastImportedAt && minutesSince(settings.lastImportedAt, now) < intervalMins) {
    return {
      run: false,
      reason: "too_soon",
      nextAllowedAt: new Date(settings.lastImportedAt.getTime() + intervalMins * 60000).toISOString(),
    };
  }

  return { run: true, reason: "due" };
}

function getMonthKeyFromRawSaleDate(rawDate: unknown) {
  const text = String(rawDate ?? "").trim();
  const explicit = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (explicit) {
    const [, year, month] = explicit;
    return `${year}-${month}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

function getDayKeyFromRawSaleDate(rawDate: unknown) {
  const text = String(rawDate ?? "").trim();
  const explicit = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (explicit) {
    const [, year, month, day] = explicit;
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
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

function findPhoneValue(value: unknown): string | null {
  const direct = normalizePhone(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return null;

  const objectValue = value as Record<string, unknown>;
  const phoneKeys = [
    "userPhone",
    "phone",
    "phoneNumber",
    "mobilePhone",
    "contactPhone",
    "homePhone",
    "workPhone",
  ];
  for (const key of phoneKeys) {
    const parsed = normalizePhone(objectValue[key]);
    if (parsed) return parsed;
  }

  const nestedKeys = ["user", "client", "contact", "profile", "details", "phone"];
  for (const key of nestedKeys) {
    const nested = objectValue[key];
    if (nested === value) continue;
    const parsed = findPhoneValue(nested);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeName(value: unknown) {
  return safeText(value).replace(/\s+/g, " ").toLowerCase();
}

function getSaleClientKey(row: MappedFitsseySale) {
  return row.userGuid?.toLowerCase()
    || row.clientUuid?.toLowerCase()
    || (row.userEmail ? `email:${row.userEmail.toLowerCase()}` : null)
    || `name:${normalizeName(row.userFullName)}`;
}

function mapSalesRowsForCache(rows: FitsseySalesRow[]): MappedFitsseySale[] {
  return rows.flatMap((row) => {
    const saleDate = new Date(row.saleDate ?? "");
    if (Number.isNaN(saleDate.getTime())) return [];

    const saleMonthKey = getMonthKeyFromRawSaleDate(row.saleDate);
    const saleDayKey = getDayKeyFromRawSaleDate(row.saleDate);
    if (!saleMonthKey || !saleDayKey) return [];

    const itemTotalPrice = Number(row.itemTotalPrice);
    const itemPrice = Number(row.itemPrice);
    const amountMinor = Number.isFinite(itemTotalPrice) ? itemTotalPrice : itemPrice;
    const amount = Number.isFinite(amountMinor) ? amountMinor / 100 : 0;
    if (!Number.isFinite(amount) || amount <= 0) return [];

    return [{
      userId: SHARED_SCOPE_ID,
      saleDate,
      saleDayKey,
      saleMonthKey,
      itemName: safeText(row.itemName) || "Produkt",
      amount,
      userGuid: safeText(row.userGuid) || null,
      clientUuid: safeText(row.clientUuid) || null,
      userFullName: safeText(row.userFullName) || "Nieznany klient",
      userEmail: normalizeEmail(row.userEmail ?? row.email),
      userPhone: findPhoneValue(row),
      passActivatedDayKey: null,
      passExpiresDayKey: null,
      passInstanceGuid: null,
    }];
  });
}

function attachPassValidity(sales: MappedFitsseySale[], pricingOptions: FitsseyClientPricingOptionRow[]) {
  type PassInstance = {
    guid: string;
    userGuid: string;
    clientUuid: string;
    productKey: string;
    activatedDayKey: string;
    expiresDayKey: string | null;
  };

  const instances = new Map<string, PassInstance>();
  for (const pricingOption of pricingOptions) {
    const guid = safeText(pricingOption.guid);
    const userGuid = safeText(pricingOption.userGuid).toLowerCase();
    const clientUuid = safeText(pricingOption.clientUuid).toLowerCase();
    const productKey = normalizeName(pricingOption.qualifiedName);
    const activatedDayKey = getDayKeyFromRawSaleDate(pricingOption.activatedAt);
    if (!guid || (!userGuid && !clientUuid) || !productKey || !activatedDayKey) continue;

    const expiresDayKey = getDayKeyFromRawSaleDate(pricingOption.expiresAt);
    const existing = instances.get(guid);
    instances.set(guid, {
      guid,
      userGuid: userGuid || existing?.userGuid || "",
      clientUuid: clientUuid || existing?.clientUuid || "",
      productKey,
      activatedDayKey: existing && existing.activatedDayKey < activatedDayKey ? existing.activatedDayKey : activatedDayKey,
      expiresDayKey: !existing?.expiresDayKey || (expiresDayKey && expiresDayKey > existing.expiresDayKey)
        ? expiresDayKey
        : existing.expiresDayKey,
    });
  }

  const salesByPass = new Map<string, MappedFitsseySale[]>();
  for (const sale of sales) {
    const identity = sale.userGuid?.toLowerCase() || sale.clientUuid?.toLowerCase();
    if (!identity) continue;
    const key = `${identity}\u0000${normalizeName(sale.itemName)}`;
    const grouped = salesByPass.get(key) ?? [];
    grouped.push(sale);
    salesByPass.set(key, grouped);
  }

  const instancesByPass = new Map<string, PassInstance[]>();
  for (const instance of instances.values()) {
    for (const identity of new Set([instance.userGuid, instance.clientUuid])) {
      if (!identity) continue;
      const key = `${identity}\u0000${instance.productKey}`;
      const grouped = instancesByPass.get(key) ?? [];
      grouped.push(instance);
      instancesByPass.set(key, grouped);
    }
  }

  for (const [key, groupedSales] of salesByPass) {
    const groupedInstances = instancesByPass.get(key);
    if (!groupedInstances) continue;
    groupedSales.sort((a, b) => a.saleDate.getTime() - b.saleDate.getTime());
    groupedInstances.sort((a, b) => a.activatedDayKey.localeCompare(b.activatedDayKey));
    for (let index = 0; index < Math.min(groupedSales.length, groupedInstances.length); index += 1) {
      const sale = groupedSales[index];
      const instance = groupedInstances[index];
      sale.passActivatedDayKey = instance.activatedDayKey;
      sale.passExpiresDayKey = instance.expiresDayKey;
      sale.passInstanceGuid = instance.guid;
    }
  }

  return sales;
}

async function replaceFitsseySalesCache(mapped: MappedFitsseySale[]) {
  if (!hasFitsseySaleDelegate()) return [];

  await db.$transaction(async (tx) => {
    await tx.fitsseySale.deleteMany({
      where: { userId: SHARED_SCOPE_ID },
    });

    if (mapped.length === 0) return;

    const chunkSize = 500;
    for (let start = 0; start < mapped.length; start += chunkSize) {
      await tx.fitsseySale.createMany({
        data: mapped.slice(start, start + chunkSize),
      });
    }
  });

  return mapped;
}

async function upsertClientContactsFromSales(rows: MappedFitsseySale[]) {
  const fitsseyClientContact = getFitsseyClientContactDelegate();
  if (!fitsseyClientContact) return 0;

  const contacts = new Map<string, MappedFitsseySale>();
  for (const row of rows) {
    const key = getSaleClientKey(row);
    const existing = contacts.get(key);
    if (!existing || (!existing.userPhone && row.userPhone) || row.saleDate > existing.saleDate) {
      contacts.set(key, row);
    }
  }

  let upserted = 0;
  for (const [clientKey, row] of contacts.entries()) {
    const updateData: {
      clientGuid: string | null;
      clientUuid: string | null;
      fullName: string;
      normalizedName: string;
      email: string | null;
    } = {
      clientGuid: row.userGuid,
      clientUuid: row.clientUuid,
      fullName: row.userFullName,
      normalizedName: normalizeName(row.userFullName),
      email: row.userEmail,
    };

    await fitsseyClientContact.upsert({
      where: { userId_clientKey: { userId: SHARED_SCOPE_ID, clientKey } },
      create: {
        userId: SHARED_SCOPE_ID,
        clientKey,
        clientGuid: row.userGuid,
        clientUuid: row.clientUuid,
        fullName: row.userFullName,
        normalizedName: normalizeName(row.userFullName),
        email: row.userEmail,
        phone: row.userPhone,
      },
      update: updateData,
    });
    if (row.userPhone) {
      await fitsseyClientContact.updateMany({
        where: { userId: SHARED_SCOPE_ID, clientKey, phone: null },
        data: { phone: row.userPhone },
      });
    }
    upserted += 1;
  }

  return upserted;
}

async function resolveAuthConfig(): Promise<FitsseyAuthConfig> {
  const settings = (await db.fitsseySettings.findUnique({ where: { userId: SHARED_SCOPE_ID } }))
    ?? (await db.fitsseySettings.findFirst({ orderBy: { updatedAt: "desc" } }));
  if (settings) {
    const defaultStartDate = DEFAULT_START_DATE;
    const startDate = settings.startDate ? settings.startDate.toISOString().slice(0, 10) : defaultStartDate;
    if (!settings.studioUuid.trim()) {
      throw new Error("Ustaw Studio UUID w Settings.");
    }
    if (!settings.apiKey) {
      throw new Error("Uzupełnij API Key Fitssey w Settings.");
    }
    return {
      studioUuid: settings.studioUuid.trim(),
      mode: "apiKey",
      apiKey: settings.apiKey,
      startDate,
    };
  }

  const studioUuid = process.env.FITSSEY_STUDIO_UUID?.trim() ?? "";
  const startDate = process.env.FITSSEY_START_DATE?.trim() || DEFAULT_START_DATE;
  if (!studioUuid) {
    throw new Error("Brak ustawień Fitssey. Uzupełnij je w Settings.");
  }
  const apiKey = process.env.FITSSEY_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("Brak API Key Fitssey.");
  }
  return {
    studioUuid,
    mode: "apiKey",
    apiKey,
    startDate,
  };
}

function buildHeaders(config: FitsseyAuthConfig): HeadersInit {
  return { Accept: "application/json", Authorization: `Bearer ${config.apiKey}` };
}

async function fetchSalesPage(baseUrl: string, studioUuid: string, startDate: string, endDate: string, page: number, headers: HeadersInit) {
  const url = `${baseUrl}/report/finance/sales?startDate=${startDate}&endDate=${endDate}&page=${page}&count=${PAGE_SIZE}`;
  const response = await fetch(url, { method: "GET", headers, cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fitssey API ${response.status} (studioUuid=${studioUuid}): ${body.slice(0, 140)}`);
  }
  return response.json() as Promise<unknown>;
}

async function fetchSalesRows(config: FitsseyAuthConfig, startDate: string, endDate: string) {
  const baseUrl = FITSSEY_BASE_URL_TEMPLATE.replace("{uuid}", encodeURIComponent(config.studioUuid));
  const headers = buildHeaders(config);

  const firstPayload = await fetchSalesPage(baseUrl, config.studioUuid, startDate, endDate, 1, headers);
  if (Array.isArray(firstPayload)) return firstPayload as FitsseySalesRow[];

  if (!firstPayload || typeof firstPayload !== "object") {
    throw new Error("Nieprawidłowy format odpowiedzi Fitssey API.");
  }

  const payload = firstPayload as { collection?: FitsseySalesRow[]; pages?: number };
  const rows = Array.isArray(payload.collection) ? [...payload.collection] : [];
  const pages = Number(payload.pages) || 1;

  for (let page = 2; page <= pages; page += 1) {
    const nextPayload = await fetchSalesPage(baseUrl, config.studioUuid, startDate, endDate, page, headers);
    if (Array.isArray(nextPayload)) {
      rows.push(...(nextPayload as FitsseySalesRow[]));
      continue;
    }
    if (nextPayload && typeof nextPayload === "object" && Array.isArray((nextPayload as { collection?: FitsseySalesRow[] }).collection)) {
      rows.push(...((nextPayload as { collection: FitsseySalesRow[] }).collection));
    }
  }

  return rows;
}

async function fetchClientPricingOptions(config: FitsseyAuthConfig, sales: MappedFitsseySale[]) {
  const baseUrl = FITSSEY_BASE_URL_TEMPLATE.replace("{uuid}", encodeURIComponent(config.studioUuid));
  const headers = buildHeaders(config);
  const clients = new Map<string, { userGuid: string; clientUuid: string | null }>();
  for (const sale of sales) {
    if (normalizeName(sale.itemName) !== "karnet bez limitu" || !sale.userGuid) continue;
    clients.set(sale.userGuid.toLowerCase(), { userGuid: sale.userGuid, clientUuid: sale.clientUuid });
  }

  const rows: FitsseyClientPricingOptionRow[] = [];
  for (const client of clients.values()) {
    const url = `${baseUrl}/client/${encodeURIComponent(client.userGuid)}/client-pricing-option/all?page=1&count=1000`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetch(url, { method: "GET", headers, cache: "no-store" });
      if (response.status !== 429) break;
      const retryAfterSeconds = Math.max(1, Number(response.headers.get("retry-after")) || 30);
      await new Promise((resolve) => setTimeout(resolve, (retryAfterSeconds + 1) * 1000));
    }
    if (!response) continue;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Fitssey client pricing options API ${response.status}: ${body.slice(0, 140)}`);
    }
    const payload = await response.json() as { collection?: FitsseyClientPricingOptionRow[] };
    if (Array.isArray(payload.collection)) {
      rows.push(...payload.collection.map((row) => ({
        ...row,
        userGuid: client.userGuid,
        clientUuid: client.clientUuid ?? undefined,
      })));
    }

    // Fitssey allows 10 requests per second; leave margin for other API calls.
    await new Promise((resolve) => setTimeout(resolve, 175));
  }
  return rows;
}

function parseVatRate(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value <= 1) return Math.round(value * 10000) / 100;
  if (value <= 100) return Math.round(value * 100) / 100;
  return null;
}

function extractFitsseyVatRate(row: FitsseySalesRow): number | null {
  const candidates = [
    row.vatRate,
    row.itemVatRate,
    row.taxRate,
    row.itemTaxRate,
    row.itemVat,
    row.itemTax,
  ];
  for (const candidate of candidates) {
    const parsed = parseVatRate(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function aggregateRevenueByProductAndMonth(rows: FitsseySalesRow[]) {
  const map = new Map<string, { name: string; monthValues: Record<string, number>; vatRateVotes: Record<string, number> }>();

  const normalizeName = (value: string) => value.replace(/\s+/g, " ").trim();

  for (const row of rows) {
    const rawProduct = (row.itemName ?? "").trim() || "Produkt";
    const product = normalizeName(rawProduct);
    const month = getMonthKeyFromRawSaleDate(row.saleDate);
    if (!month) continue;

    const itemTotalPrice = Number(row.itemTotalPrice);
    const itemPrice = Number(row.itemPrice);
    const amountMinor = Number.isFinite(itemTotalPrice) ? itemTotalPrice : itemPrice;
    const amount = Number.isFinite(amountMinor) ? amountMinor / 100 : 0;
    if (!Number.isFinite(amount) || amount === 0) continue;

    const record = map.get(product) ?? { name: product, monthValues: {}, vatRateVotes: {} };
    const monthValues = record.monthValues;
    monthValues[month] = (monthValues[month] ?? 0) + amount;
    const rowVatRate = extractFitsseyVatRate(row);
    if (rowVatRate !== null) {
      const key = String(rowVatRate);
      record.vatRateVotes[key] = (record.vatRateVotes[key] ?? 0) + 1;
    }
    record.name = product;
    map.set(product, record);
  }

  const normalized = new Map<string, { name: string; monthValues: Record<string, number>; vatRate: number }>();
  for (const [key, value] of map.entries()) {
    const roundedMonthValues: Record<string, number> = {};
    let total = 0;
    for (const [month, monthAmount] of Object.entries(value.monthValues)) {
      const rounded = Math.round(monthAmount);
      if (rounded === 0) continue;
      roundedMonthValues[month] = rounded;
      total += rounded;
    }
    if (total <= 0) continue;
    const votedRates = Object.entries(value.vatRateVotes);
    const vatRate = votedRates.length
      ? Number(votedRates.sort((a, b) => b[1] - a[1])[0][0])
      : 8;
    normalized.set(key, { name: value.name, monthValues: roundedMonthValues, vatRate });
  }
  return normalized;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { auto?: boolean };
    const isAutoImport = body.auto === true;

    const now = new Date();
    if (isAutoImport) {
      const autoDecision = await shouldRunAutoImport(now);
      if (!autoDecision.run) {
        return NextResponse.json({
          skipped: true,
          reason: autoDecision.reason,
          nextAllowedAt: "nextAllowedAt" in autoDecision ? autoDecision.nextAllowedAt : undefined,
        });
      }
      await updateImportStatus("running: auto import");
    } else {
      await updateImportStatus("running: manual import");
    }

    const config = await resolveAuthConfig();
    const startDate = config.startDate || DEFAULT_START_DATE;
    const endDate = now.toISOString().slice(0, 10);
    const rows = await fetchSalesRows(config, startDate, endDate);
    const mappedSales = mapSalesRowsForCache(rows);
    const clientPricingOptions = await fetchClientPricingOptions(config, mappedSales);
    const mappedRows = await replaceFitsseySalesCache(
      attachPassValidity(mappedSales, clientPricingOptions),
    );
    const passValidityMatched = mappedRows.filter((row) => row.passExpiresDayKey !== null).length;
    const contactsUpserted = await upsertClientContactsFromSales(mappedRows);
    const aggregated = aggregateRevenueByProductAndMonth(rows);

    if (aggregated.size === 0) {
      await updateImportStatus("ok: 0 produktów", new Date());
      return NextResponse.json({ created: 0, updated: 0, products: 0 });
    }

    let created = 0;
    let updated = 0;
    let deletedDuplicates = 0;

    const existingImported = await db.flowRow.findMany({
      where: {
        type: "income",
        OR: [
          { isImported: true },
          { amount: 0, startMonth: "2000-01" },
        ],
      },
      select: { id: true, name: true, createdAt: true, monthValues: true },
      orderBy: { createdAt: "asc" },
    });
    const normalizeName = (value: string) => value.replace(/\s+/g, " ").trim();
    const existingByName = new Map<string, { id: string; name: string }[]>();
    for (const row of existingImported) {
      const key = normalizeName(row.name);
      const grouped = existingByName.get(key) ?? [];
      grouped.push({ id: row.id, name: row.name });
      existingByName.set(key, grouped);
    }

    const seenKeys = new Set<string>();

    const aggregatedEntries = [...aggregated.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "pl", { sensitivity: "base" }));

    for (const [key, data] of aggregatedEntries) {
      const { name, monthValues, vatRate } = data;
      if (Object.keys(monthValues).length === 0) continue;
      seenKeys.add(key);
      const existingRows = existingByName.get(key) ?? [];

      if (existingRows.length === 0) {
        await db.flowRow.create({
          data: {
            userId: SHARED_SCOPE_ID,
            type: "income",
            name,
            isImported: true,
            vatRate,
            amount: 0,
            startMonth: "2000-01",
            endMonth: null,
            monthValues,
          },
        });
        created += 1;
      } else {
        const [keeper, ...duplicates] = existingRows;
        await db.flowRow.update({
          where: { id: keeper.id },
          data: {
            name,
            isImported: true,
            vatRate,
            amount: 0,
            startMonth: "2000-01",
            endMonth: null,
            monthValues,
          },
        });
        updated += 1;
        if (duplicates.length > 0) {
          const deleted = await db.flowRow.deleteMany({
            where: { id: { in: duplicates.map((row) => row.id) } },
          });
          deletedDuplicates += deleted.count;
        }
      }
    }

    const staleRows = existingImported
      .filter((row) => !seenKeys.has(normalizeName(row.name)))
      .map((row) => row.id);
    if (staleRows.length > 0) {
      const deleted = await db.flowRow.deleteMany({
        where: { id: { in: staleRows } },
      });
      deletedDuplicates += deleted.count;
    }

    // Safety cleanup for legacy/invalid imported rows with zero total history.
    const zeroTotalImportedIds = existingImported
      .filter((row) => {
        const monthValues = row.monthValues as Record<string, unknown>;
        const total = Object.values(monthValues ?? {}).reduce<number>(
          (sum, value) => sum + (typeof value === "number" ? value : Number(value) || 0),
          0,
        );
        return total <= 0;
      })
      .map((row) => row.id);
    if (zeroTotalImportedIds.length > 0) {
      const deleted = await db.flowRow.deleteMany({
        where: { id: { in: zeroTotalImportedIds } },
      });
      deletedDuplicates += deleted.count;
    }

    await updateImportStatus(`ok: products=${aggregated.size}, created=${created}, updated=${updated}, removed=${deletedDuplicates}, contacts=${contactsUpserted}, passValidity=${passValidityMatched}`, new Date());

    return NextResponse.json({ created, updated, products: aggregated.size, removed: deletedDuplicates, contacts: contactsUpserted, passValidity: passValidityMatched, skipped: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    await updateImportStatus(`error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
