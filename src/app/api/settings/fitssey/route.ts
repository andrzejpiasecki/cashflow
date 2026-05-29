import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

const DEFAULT_START_DATE = "2025-10-01";
const DEFAULT_WELCOME_SMS_MESSAGE = "Cześć {imie}, tu Reforma Pilates. Dziękujemy za zakup i witamy w studiu! Jeśli masz pytania albo chcesz dobrać termin zajęć, odpisz na tę wiadomość.";

type SmsTemplate = {
  id: string;
  label: string;
  message: string;
};

const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: "welcome",
    label: "Powitalny",
    message: DEFAULT_WELCOME_SMS_MESSAGE,
  },
  {
    id: "first_visit",
    label: "Pierwsza wizyta",
    message: "Dzień dobry {imie}! Przypominamy, że jeśli to Twoje pierwsze zajęcia na reformerze, najlepiej wybrać grupę Reformer Start. Do zobaczenia w Studio Re•forma.",
  },
  {
    id: "renewal",
    label: "Odnowienie karnetu",
    message: "Cześć {imie}, tu Reforma Pilates. Twój karnet dobiega końca lub jest już po terminie. Jeśli chcesz kontynuować zajęcia, odpisz na tę wiadomość, a pomożemy dobrać termin.",
  },
];

function getFitsseySettingsDelegate() {
  const delegate = (db as unknown as { fitsseySettings?: typeof db.fitsseySettings }).fitsseySettings;
  return delegate;
}

function maskSecret(secret: string | null | undefined) {
  if (!secret) return null;
  const suffix = secret.slice(-4);
  return `••••••••${suffix}`;
}

function parseIsoDateOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isValidStudioUuid(value: string) {
  return /^[A-Za-z0-9_-]{2,80}$/.test(value);
}

async function getSharedSettings() {
  const fitsseySettings = getFitsseySettingsDelegate();
  if (!fitsseySettings) return null;
  const shared = await fitsseySettings.findUnique({ where: { userId: SHARED_SCOPE_ID } });
  if (shared) return shared;
  return fitsseySettings.findFirst({ orderBy: { updatedAt: "desc" } });
}

async function getWelcomeSmsMessage() {
  try {
    const rows = await db.$queryRaw<{ welcomeSmsMessage: string | null }[]>`
      SELECT "welcomeSmsMessage" FROM "FitsseySettings" WHERE "userId" = ${SHARED_SCOPE_ID} LIMIT 1
    `;
    return rows[0]?.welcomeSmsMessage || DEFAULT_WELCOME_SMS_MESSAGE;
  } catch {
    return DEFAULT_WELCOME_SMS_MESSAGE;
  }
}

function normalizeSmsTemplates(value: unknown, welcomeSmsMessage = DEFAULT_WELCOME_SMS_MESSAGE): SmsTemplate[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SMS_TEMPLATES.map((template) => template.id === "welcome" ? { ...template, message: welcomeSmsMessage } : template);
  }

  const templates = value.flatMap((item): SmsTemplate[] => {
    if (!item || typeof item !== "object") return [];
    const objectItem = item as Record<string, unknown>;
    const id = String(objectItem.id ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "_") || crypto.randomUUID();
    const label = String(objectItem.label ?? "").trim();
    const message = String(objectItem.message ?? "").trim();
    if (!label || !message) return [];
    return [{ id, label, message }];
  });

  return templates.length > 0 ? templates.slice(0, 12) : DEFAULT_SMS_TEMPLATES;
}

async function getSmsTemplates(welcomeSmsMessage: string) {
  try {
    const rows = await db.$queryRaw<{ smsTemplates: unknown }[]>`
      SELECT "smsTemplates" FROM "FitsseySettings" WHERE "userId" = ${SHARED_SCOPE_ID} LIMIT 1
    `;
    return normalizeSmsTemplates(rows[0]?.smsTemplates, welcomeSmsMessage);
  } catch {
    return normalizeSmsTemplates(null, welcomeSmsMessage);
  }
}

async function saveWelcomeSmsMessage(message: string) {
  await db.$executeRaw`
    UPDATE "FitsseySettings" SET "welcomeSmsMessage" = ${message} WHERE "userId" = ${SHARED_SCOPE_ID}
  `;
}

async function saveSmsTemplates(templates: SmsTemplate[]) {
  await db.$executeRaw`
    UPDATE "FitsseySettings" SET "smsTemplates" = ${JSON.stringify(templates)}::jsonb WHERE "userId" = ${SHARED_SCOPE_ID}
  `;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fitsseySettings = getFitsseySettingsDelegate();
  if (!fitsseySettings) {
    return NextResponse.json(
      { error: "Prisma client bez modelu FitsseySettings. Uruchom: yarn prisma generate i zrestartuj dev server." },
      { status: 503 },
    );
  }

  const settings = await getSharedSettings();
  const welcomeSmsMessage = await getWelcomeSmsMessage();
  const smsTemplates = await getSmsTemplates(welcomeSmsMessage);
  if (!settings) {
    return NextResponse.json({
      studioUuid: "",
      apiKeyConfigured: false,
      apiKeyPreview: null,
      startDate: DEFAULT_START_DATE,
      citRate: 19,
      vatRate: 23,
      welcomeSmsMessage,
      smsTemplates,
      lastImportedAt: null,
      lastImportStatus: null,
    });
  }

  return NextResponse.json({
    studioUuid: settings.studioUuid,
    apiKeyConfigured: Boolean(settings.apiKey),
    apiKeyPreview: maskSecret(settings.apiKey),
    startDate: settings.startDate ? settings.startDate.toISOString().slice(0, 10) : "",
    citRate: settings.citRate,
    vatRate: settings.vatRate,
    welcomeSmsMessage,
    smsTemplates,
    lastImportedAt: settings.lastImportedAt?.toISOString() ?? null,
    lastImportStatus: settings.lastImportStatus ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fitsseySettings = getFitsseySettingsDelegate();
  if (!fitsseySettings) {
    return NextResponse.json(
      { error: "Prisma client bez modelu FitsseySettings. Uruchom: yarn prisma generate i zrestartuj dev server." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    studioUuid?: string;
    apiKey?: string;
    startDate?: string;
    citRate?: number;
    vatRate?: number;
    welcomeSmsMessage?: string;
    smsTemplates?: unknown;
  };

  const studioUuid = String(body.studioUuid ?? "").trim();
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;
  const startDate = parseIsoDateOrNull(body.startDate);
  const citRate = Number(body.citRate ?? 19);
  const vatRate = Number(body.vatRate ?? 23);
  const smsTemplates = normalizeSmsTemplates(body.smsTemplates, String(body.welcomeSmsMessage ?? DEFAULT_WELCOME_SMS_MESSAGE).trim() || DEFAULT_WELCOME_SMS_MESSAGE);
  const welcomeSmsMessage = smsTemplates.find((template) => template.id === "welcome")?.message
    ?? (String(body.welcomeSmsMessage ?? DEFAULT_WELCOME_SMS_MESSAGE).trim() || DEFAULT_WELCOME_SMS_MESSAGE);
  const normalizedCitRate = Number.isFinite(citRate) ? Math.min(100, Math.max(0, citRate)) : 19;
  const normalizedVatRate = Number.isFinite(vatRate) ? Math.min(100, Math.max(0, vatRate)) : 23;

  if (!studioUuid) {
    return NextResponse.json({ error: "Studio UUID jest wymagane." }, { status: 400 });
  }
  if (!isValidStudioUuid(studioUuid)) {
    return NextResponse.json(
      { error: "Niepoprawny Studio UUID. To nie jest email, tylko slug studia z URL Fitssey (np. Reformapilates)." },
      { status: 400 },
    );
  }

  const existing = await getSharedSettings();
  const nextApiKey = apiKey !== undefined && apiKey.length > 0 ? apiKey : existing?.apiKey ?? null;
  if (!nextApiKey) {
    return NextResponse.json({ error: "Podaj API Key Fitssey." }, { status: 400 });
  }

  try {
    const saved = await fitsseySettings.upsert({
      where: { userId: SHARED_SCOPE_ID },
      create: {
        userId: SHARED_SCOPE_ID,
        studioUuid,
        authMode: "apiKey",
        apiKey: nextApiKey,
        username: null,
        password: null,
        startDate,
        citRate: normalizedCitRate,
        vatRate: normalizedVatRate,
        autoImportEnabled: true,
        autoImportIntervalMins: 180,
      },
      update: {
        studioUuid,
        authMode: "apiKey",
        apiKey: nextApiKey,
        username: null,
        password: null,
        startDate,
        citRate: normalizedCitRate,
        vatRate: normalizedVatRate,
        autoImportEnabled: true,
        autoImportIntervalMins: 180,
      },
    });
    await saveWelcomeSmsMessage(welcomeSmsMessage);
    await saveSmsTemplates(smsTemplates);

    return NextResponse.json({
      studioUuid: saved.studioUuid,
      apiKeyConfigured: Boolean(saved.apiKey),
      apiKeyPreview: maskSecret(saved.apiKey),
      startDate: saved.startDate ? saved.startDate.toISOString().slice(0, 10) : "",
      citRate: saved.citRate,
      vatRate: saved.vatRate,
      welcomeSmsMessage,
      smsTemplates,
      lastImportedAt: saved.lastImportedAt?.toISOString() ?? null,
      lastImportStatus: saved.lastImportStatus ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zapisać ustawień.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
