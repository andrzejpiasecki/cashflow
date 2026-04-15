import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

const DEFAULT_START_DATE = "2025-10-01";

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
  if (!settings) {
    return NextResponse.json({
      studioUuid: "",
      apiKeyConfigured: false,
      apiKeyPreview: null,
      startDate: DEFAULT_START_DATE,
      citRate: 19,
      vatRate: 23,
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
  };

  const studioUuid = String(body.studioUuid ?? "").trim();
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;
  const startDate = parseIsoDateOrNull(body.startDate);
  const citRate = Number(body.citRate ?? 19);
  const vatRate = Number(body.vatRate ?? 23);
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

  return NextResponse.json({
    studioUuid: saved.studioUuid,
    apiKeyConfigured: Boolean(saved.apiKey),
    apiKeyPreview: maskSecret(saved.apiKey),
    startDate: saved.startDate ? saved.startDate.toISOString().slice(0, 10) : "",
    citRate: saved.citRate,
    vatRate: saved.vatRate,
    lastImportedAt: saved.lastImportedAt?.toISOString() ?? null,
    lastImportStatus: saved.lastImportStatus ?? null,
  });
}
