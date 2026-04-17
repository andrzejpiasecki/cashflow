import { db } from "@/lib/db";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

const FITSSEY_BASE_URL_TEMPLATE = "https://app.fitssey.com/{uuid}/api/v4/public";
const PAGE_SIZE = 200;
const ENTRY_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

type FitsseyClientApiRow = {
  guid?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  contactEmailAddress?: string;
  client?: {
    uuid?: string;
    phone?: {
      mobilePhone?: string;
      homePhone?: string;
      workPhone?: string;
    };
  };
};

type NormalizedFitsseyClient = {
  externalGuid: string;
  clientUuid: string | null;
  fullName: string;
  normalizedName: string;
  email: string | null;
  phone: string | null;
};

type CachedClientForEntries = {
  externalGuid: string;
  clientUuid: string | null;
  activeEntries: number | null;
  entriesUpdatedAt: Date | null;
};

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
  const cleaned = safeText(value).replace(/[^\d+]/g, "");
  return cleaned.length >= 6 ? cleaned : null;
}

function parseClientRows(payload: unknown) {
  if (Array.isArray(payload)) return payload as FitsseyClientApiRow[];
  if (!payload || typeof payload !== "object") return [];
  const collection = (payload as { collection?: unknown }).collection;
  return Array.isArray(collection) ? (collection as FitsseyClientApiRow[]) : [];
}

function parsePages(payload: unknown) {
  if (!payload || typeof payload !== "object") return 1;
  const pages = Number((payload as { pages?: unknown }).pages);
  return Number.isFinite(pages) && pages > 0 ? pages : 1;
}

function parseCollection(payload: unknown) {
  if (Array.isArray(payload)) return payload as unknown[];
  if (!payload || typeof payload !== "object") return [];
  const collection = (payload as { collection?: unknown }).collection;
  return Array.isArray(collection) ? collection : [];
}

function toFiniteInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function extractEntriesFromValue(value: unknown): number | null {
  const direct = toFiniteInt(value);
  if (direct !== null) return direct;
  if (!value || typeof value !== "object") return null;

  const objectValue = value as Record<string, unknown>;
  const keys = [
    "remainingEntries",
    "availableEntries",
    "activeEntries",
    "entriesLeft",
    "leftEntries",
    "unusedEntries",
    "quantityAvailable",
    "leftQuantity",
    "remainingQuantity",
  ];
  let best: number | null = null;

  for (const key of keys) {
    const parsed = toFiniteInt(objectValue[key]);
    if (parsed === null) continue;
    best = best === null ? parsed : Math.max(best, parsed);
  }

  const nestedCandidates = [
    objectValue.item,
    objectValue.pass,
    objectValue.passInstance,
    objectValue.contract,
    objectValue.clientContract,
    objectValue.pricingOption,
    objectValue.clientPricingOption,
    objectValue.meta,
  ];
  for (const nested of nestedCandidates) {
    const parsed = extractEntriesFromValue(nested);
    if (parsed === null) continue;
    best = best === null ? parsed : Math.max(best, parsed);
  }
  return best;
}

function mapClientRow(row: FitsseyClientApiRow): NormalizedFitsseyClient | null {
  const externalGuid = safeText(row.guid);
  if (!externalGuid) return null;

  const fullName = safeText(row.fullName) || safeText(`${safeText(row.firstName)} ${safeText(row.lastName)}`) || "Nieznany klient";
  const normalizedName = normalizeName(fullName);
  const email = normalizeEmail(row.contactEmailAddress ?? row.emailAddress);
  const phone = normalizePhone(row.client?.phone?.mobilePhone ?? row.client?.phone?.homePhone ?? row.client?.phone?.workPhone);
  const clientUuid = safeText(row.client?.uuid) || null;

  return {
    externalGuid,
    clientUuid,
    fullName,
    normalizedName,
    email,
    phone,
  };
}

function getFitsseyClientDelegate() {
  return (db as unknown as { fitsseyClient?: typeof db.fitsseyClient }).fitsseyClient;
}

export async function fetchFitsseyClients(studioUuid: string, apiKey: string): Promise<NormalizedFitsseyClient[]> {
  const baseUrl = FITSSEY_BASE_URL_TEMPLATE.replace("{uuid}", encodeURIComponent(studioUuid.trim()));
  const headers: HeadersInit = { Accept: "application/json", Authorization: `Bearer ${apiKey.trim()}` };

  const fetchPage = async (page: number) => {
    const url = `${baseUrl}/client/all?page=${page}&count=${PAGE_SIZE}`;
    const response = await fetch(url, { method: "GET", headers, cache: "no-store" });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Fitssey clients API ${response.status}: ${body.slice(0, 160)}`);
    }
    return response.json() as Promise<unknown>;
  };

  const firstPayload = await fetchPage(1);
  const pages = parsePages(firstPayload);
  const normalizedRows: NormalizedFitsseyClient[] = [];

  for (const row of parseClientRows(firstPayload)) {
    const mapped = mapClientRow(row);
    if (!mapped) continue;
    normalizedRows.push(mapped);
  }

  for (let page = 2; page <= pages; page += 1) {
    const payload = await fetchPage(page);
    for (const row of parseClientRows(payload)) {
      const mapped = mapClientRow(row);
      if (!mapped) continue;
      normalizedRows.push(mapped);
    }
  }

  return normalizedRows;
}

export async function syncFitsseyClientsCache(studioUuid: string, apiKey: string) {
  const fitsseyClient = getFitsseyClientDelegate();
  if (!fitsseyClient) return { fetched: 0, upserted: 0 };

  const normalizedRows = await fetchFitsseyClients(studioUuid, apiKey);
  const fetched = normalizedRows.length;
  let upserted = 0;

  try {
    for (const client of normalizedRows) {
      await fitsseyClient.upsert({
        where: {
          userId_externalGuid: {
            userId: SHARED_SCOPE_ID,
            externalGuid: client.externalGuid,
          },
        },
        create: {
          userId: SHARED_SCOPE_ID,
          externalGuid: client.externalGuid,
          clientUuid: client.clientUuid,
          fullName: client.fullName,
          normalizedName: client.normalizedName,
          email: client.email,
          phone: client.phone,
        },
        update: {
          clientUuid: client.clientUuid,
          fullName: client.fullName,
          normalizedName: client.normalizedName,
          email: client.email,
          phone: client.phone,
        },
      });
      upserted += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not exist")) {
      return { fetched, upserted: 0 };
    }
    throw error;
  }

  return { fetched, upserted };
}

async function fetchEntriesByEndpoint(baseUrl: string, headers: HeadersInit, endpointPath: string) {
  const response = await fetch(`${baseUrl}${endpointPath}?page=1&count=200`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 404 || response.status === 429) return null;
    throw new Error(`Fitssey entries API ${response.status}: ${body.slice(0, 140)}`);
  }
  const payload = await response.json() as unknown;
  const entries = parseCollection(payload)
    .map((row) => extractEntriesFromValue(row))
    .filter((value): value is number => value !== null);
  if (entries.length === 0) return null;
  return Math.max(...entries);
}

async function fetchClientActiveEntries(studioUuid: string, apiKey: string, userId: string) {
  const baseUrl = FITSSEY_BASE_URL_TEMPLATE.replace("{uuid}", encodeURIComponent(studioUuid.trim()));
  const headers: HeadersInit = { Accept: "application/json", Authorization: `Bearer ${apiKey.trim()}` };

  const contractPath = `/client/${encodeURIComponent(userId)}/client-contract/all`;
  const fromContracts = await fetchEntriesByEndpoint(baseUrl, headers, contractPath);
  if (fromContracts !== null) return { activeEntries: fromContracts, source: "client-contract" };

  const pricingPath = `/client/${encodeURIComponent(userId)}/client-pricing-option/all`;
  const fromPricingOptions = await fetchEntriesByEndpoint(baseUrl, headers, pricingPath);
  if (fromPricingOptions !== null) return { activeEntries: fromPricingOptions, source: "client-pricing-option" };

  return { activeEntries: null, source: null };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  if (items.length === 0) return;
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function syncFitsseyClientEntriesForUsers(
  studioUuid: string,
  apiKey: string,
  users: { externalGuid: string; clientUuid?: string | null }[],
) {
  const fitsseyClient = getFitsseyClientDelegate();
  if (!fitsseyClient || users.length === 0) return { checked: 0, updated: 0 };

  const uniqueUsers = new Map<string, { externalGuid: string; clientUuid?: string | null }>();
  for (const user of users) {
    if (!user.externalGuid) continue;
    if (!uniqueUsers.has(user.externalGuid)) {
      uniqueUsers.set(user.externalGuid, user);
    }
  }

  const knownRows = await fitsseyClient.findMany({
    where: {
      userId: SHARED_SCOPE_ID,
      externalGuid: { in: [...uniqueUsers.keys()] },
    },
    select: {
      externalGuid: true,
      activeEntries: true,
      entriesUpdatedAt: true,
    },
  }) as CachedClientForEntries[];
  const knownByGuid = new Map(knownRows.map((row) => [row.externalGuid, row]));
  const now = Date.now();
  const toSync = [...uniqueUsers.values()].filter((user) => {
    const known = knownByGuid.get(user.externalGuid);
    if (!known?.entriesUpdatedAt) return true;
    return now - known.entriesUpdatedAt.getTime() > ENTRY_CACHE_TTL_MS;
  }).slice(0, 40);

  let updated = 0;
  await runWithConcurrency(toSync, 5, async (user) => {
    try {
      const result = await fetchClientActiveEntries(studioUuid, apiKey, user.externalGuid);
      await fitsseyClient.updateMany({
        where: { userId: SHARED_SCOPE_ID, externalGuid: user.externalGuid },
        data: {
          activeEntries: result.activeEntries,
          entriesSource: result.source,
          entriesUpdatedAt: new Date(),
        },
      });
      updated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("429")) return;
      console.error(`Entries sync failed for ${user.externalGuid}:`, error);
    }
  });

  return { checked: toSync.length, updated };
}

export async function getCachedFitsseyClients() {
  const fitsseyClient = getFitsseyClientDelegate();
  if (!fitsseyClient) return [];
  try {
    return await fitsseyClient.findMany({
      where: { userId: SHARED_SCOPE_ID },
      select: {
        externalGuid: true,
        clientUuid: true,
        fullName: true,
        normalizedName: true,
        email: true,
        phone: true,
        activeEntries: true,
        entriesSource: true,
        entriesUpdatedAt: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not exist")) return [];
    throw error;
  }
}
